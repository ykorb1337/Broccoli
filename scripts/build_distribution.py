#!/usr/bin/env python3
"""Build self-contained native setup tools and a compressed disk image."""
import hashlib
import json
import platform
import plistlib
import shutil
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
BUILD=ROOT/'build'

def sign(path):
    subprocess.run(['/usr/bin/codesign','--force','--deep','--sign','-',str(path)],check=True)
    subprocess.run(['/usr/bin/codesign','--verify','--deep','--strict',str(path)],check=True)

def compile_setup(mode):
    binary=BUILD/('BroccoliUninstaller' if mode=='uninstall' else 'BroccoliInstaller')
    architecture='arm64' if platform.machine()=='arm64' else 'x86_64'
    flags=['-D','BROCCOLI_UNINSTALLER'] if mode=='uninstall' else []
    subprocess.run(['/usr/bin/swiftc','-swift-version','5','-O',*flags,'-target',architecture+'-apple-macos12.0','-module-cache-path',str(BUILD/'swift-cache'),str(ROOT/'native/Setup.swift'),'-framework','AppKit','-o',str(binary)],check=True)
    return binary

def shell(path,mode,main):
    if path.exists():shutil.rmtree(path)
    contents=path/'Contents';resources=contents/'Resources';(contents/'MacOS').mkdir(parents=True);resources.mkdir()
    shutil.copy2(BUILD/('BroccoliUninstaller' if mode=='uninstall' else 'BroccoliInstaller'),contents/'MacOS/BroccoliSetup')
    shutil.copy2(main/'Contents/Resources/Broccoli.icns',resources/'Broccoli.icns')
    version=plistlib.loads((main/'Contents/Info.plist').read_bytes())
    info={'CFBundleName':'Broccoli '+('Uninstaller' if mode=='uninstall' else 'Installer'),'CFBundleDisplayName':'Broccoli Uninstaller' if mode=='uninstall' else 'Broccoli Installer','CFBundleIdentifier':'local.broccoli.'+('uninstaller' if mode=='uninstall' else 'installer'),'CFBundleExecutable':'BroccoliSetup','CFBundlePackageType':'APPL','CFBundleIconFile':'Broccoli.icns','CFBundleVersion':version['CFBundleVersion'],'CFBundleShortVersionString':version['CFBundleShortVersionString'],'LSMinimumSystemVersion':'12.0','NSHighResolutionCapable':True,'BroccoliSetupMode':mode}
    (contents/'Info.plist').write_bytes(plistlib.dumps(info));return resources

def build_uninstaller(main):
    compile_setup('uninstall')
    path=BUILD/'Broccoli Uninstaller.app';resources=shell(path,'uninstall',main)
    source=main/'Contents/Resources'
    shutil.copytree(source/'python',resources/'python',symlinks=True)
    shutil.copytree(source/'ThirdParty',resources/'ThirdParty',symlinks=True)
    project=resources/'project';project.mkdir();(project/'scripts').mkdir()
    shutil.copytree(ROOT/'hotturkey',project/'hotturkey',ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    shutil.copy2(ROOT/'scripts/install.py',project/'scripts/install.py')
    sign(path);return path

def validate_main(main):
    if (main/'Contents/Resources/project/hotturkey/uninstall.py').exists() or any('uninstall' in p.name.lower() for p in main.rglob('*.app')):
        raise ValueError('The main installer must not include the uninstaller')
    project=main/'Contents/Resources/project'
    for path in project.rglob('*'):
        if path.is_file() and ('.sqlite3' in path.name or path.name=='connection.json' or path.name.startswith('client_secret') and path.suffix=='.json'):
            raise ValueError('The distribution must not include local data or credentials')

def distribution(main):
    validate_main(main)
    compile_setup('install')
    out=ROOT/'dist';out.mkdir(exist_ok=True)
    stage=BUILD/'distribution-broccoli';
    if stage.exists():shutil.rmtree(stage)
    stage.mkdir()
    installer=stage/'Broccoli Installer.app';resources=shell(installer,'install',main)
    (resources/'payload').mkdir();shutil.copytree(main,resources/'payload/Broccoli.app',symlinks=True)
    sign(installer)
    info=plistlib.loads((main/'Contents/Info.plist').read_bytes());version=info['CFBundleShortVersionString'];architecture=platform.machine()
    stem=f'Broccoli-{version}-macOS-{architecture}'
    image=out/(stem+'.dmg')
    if image.exists():image.unlink()
    subprocess.run(['/usr/bin/hdiutil','create','-volname','Broccoli','-srcfolder',str(stage),'-format','UDZO','-ov',str(image)],check=True)
    subprocess.run(['/usr/bin/hdiutil','verify',str(image)],check=True)
    uninstall=out/(f'Broccoli-Uninstaller-{version}-macOS-{architecture}.zip')
    subprocess.run(['/usr/bin/ditto','-c','-k','--sequesterRsrc','--keepParent',str(BUILD/'Broccoli Uninstaller.app'),str(uninstall)],check=True)
    extension=out/(f'Broccoli-Browser-Extension-{version}.zip')
    subprocess.run(['/usr/bin/ditto','-c','-k','--keepParent',str(ROOT/'extension'),str(extension)],check=True)
    files=[image,uninstall,extension]
    (out/'SHA256SUMS.txt').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in files))
    (BUILD/'distribution-proof.json').write_text(json.dumps({'version':version,'build':info['CFBundleVersion'],'architecture':architecture,'uninstaller_bundled':False,'developer_id_signed':False,'notarized':False,'files':[{'name':p.name,'size':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]},indent=2))
    print('Distribution:',image)

if __name__=='__main__':
    app=BUILD/'Broccoli.app';build_uninstaller(app);sign(app);distribution(app)
