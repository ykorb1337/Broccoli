"""Use one configured identity across app, helpers and setup bundles."""
import os
import subprocess


def command(path,*,deep=False,runtime=False):
    identity=os.environ.get('BROCCOLI_SIGNING_IDENTITY','-').strip()
    if not identity:raise ValueError('BROCCOLI_SIGNING_IDENTITY must not be empty')
    args=['/usr/bin/codesign','--force']
    if deep:args.append('--deep')
    if runtime or identity!='-':args.extend(['--options','runtime'])
    if identity!='-':args.append('--timestamp')
    return args+['--sign',identity,str(path)]


def sign(path,*,deep=False,runtime=False,quiet=False):
    subprocess.run(command(path,deep=deep,runtime=runtime),check=True,
                   **({'stdout':subprocess.DEVNULL,'stderr':subprocess.PIPE} if quiet else {}))


def developer_id_signed(path):
    result=subprocess.run(['/usr/bin/codesign','--display','--verbose=2',str(path)],capture_output=True,text=True,check=True)
    return 'Authority=Developer ID Application:' in result.stderr
