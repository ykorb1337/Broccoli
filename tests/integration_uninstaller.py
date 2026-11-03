"""Real current-UID disposable launchd jobs; never installs or removes the real app."""
import json
import os
import plistlib
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from broccoli.setup import Setup
from broccoli.store import Store
from broccoli.engine import Engine

def main():
    prefix='local.broccoli.setup.qa.'+uuid.uuid4().hex
    with tempfile.TemporaryDirectory(prefix='broccoli-uninstall-qa-',dir='/private/tmp') as directory:
        root=Path(directory);setup=Setup(root/'home',job_prefix=prefix)
        assert setup.home.is_relative_to(root) if hasattr(setup.home,'is_relative_to') else root in setup.home.parents
        (setup.app/'Contents/MacOS').mkdir(parents=True);(setup.app/'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':'local.hotturkey.desktop'}))
        source=root/'fixture.c';source.write_text('#include <unistd.h>\nint main(void){for(;;)pause();}\n')
        executable=setup.app/'Contents/MacOS/HotTurkey'
        subprocess.run(['/usr/bin/clang',str(source),'-o',str(executable)],check=True)
        service_executable=root/'ServiceFixture';service_executable.write_bytes(executable.read_bytes());service_executable.chmod(0o700)
        (setup.data/'runtime').mkdir(parents=True);(setup.data/'runtime/keep').write_text('fixture')
        store=Store(setup.data);engine=Engine(store)
        rule=engine.save_block({'name':'Disposable blocked tool','enabled':True,'applications':['bundle:local.broccoli.uninstaller']})
        setup.service.parent.mkdir(parents=True)
        jobs=[(setup.service,prefix+'.service',service_executable),(setup.desktop,prefix+'.desktop',executable)]
        try:
            for path,label,program in jobs:
                path.write_bytes(plistlib.dumps({'Label':label,'ProgramArguments':[str(program)],'RunAtLoad':True}))
                subprocess.run(['/bin/launchctl','bootstrap',f'gui/{os.getuid()}',str(path)],check=True)
            assert setup.loaded(setup.service) and setup.loaded(setup.desktop)
            try:setup.uninstall(root/'Downloaded Tool.app')
            except ValueError:pass
            else:raise AssertionError('Blocked uninstaller was allowed')
            assert setup.loaded(setup.service) and setup.loaded(setup.desktop),'Blocked attempt stopped a job'
            engine.toggle(rule['id'],False)
            locked=engine.save_block({'name':'Unrelated locked rule','enabled':True,'websites':['example.invalid']});engine.set_lock(locked['id'],{'type':'timer','until':engine.now()+600})
            before=store.db.execute('SELECT value FROM state').fetchone()[0]
            result=setup.uninstall(root/'Downloaded Tool.app')
            assert result['data_preserved'] and not setup.app.exists() and (setup.data/'broccoli.sqlite3').exists()
            assert not setup.loaded(setup.service) and not setup.loaded(setup.desktop)
            assert store.db.execute('SELECT value FROM state').fetchone()[0]==before
            proof={'real_disposable_jobs_stopped':True,'blocked_tool_left_jobs_running':True,'unrelated_lock_did_not_trap_user':True,'policy_and_data_preserved':True,'real_installation_modified':False,'device_actions_run':False}
            (ROOT/'build/uninstaller-integration-proof.json').write_text(json.dumps(proof,indent=2));print(json.dumps(proof))
        finally:
            store.db.close()
            for _,label,_ in jobs:subprocess.run(['/bin/launchctl','bootout',f'gui/{os.getuid()}/'+label],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

if __name__=='__main__':main()
