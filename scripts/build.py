#!/usr/bin/env python3
"""Build a native .app and its helper using the macOS Command Line Tools."""
import json
import argparse
import os
import plistlib
import platform
import shutil
import subprocess
import sys
from pathlib import Path
try:from signing import sign
except ModuleNotFoundError:from scripts.signing import sign

ROOT=Path(__file__).resolve().parent.parent
BUILD=ROOT/"build"

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--qa",action="store_true",help="额外构建使用项目内测试数据的 QA 应用")
    parser.add_argument('--system-python',action='store_true',help='仅供开发：使用构建机 Python，不打包独立运行时')
    parser.add_argument('--archive',action='store_true',help='额外生成保留应用签名与链接的 ZIP 包')
    parser.add_argument('--distribution',action='store_true',help='构建原生安装器、卸载器和 DMG 发行包')
    args=parser.parse_args()
    BUILD.mkdir(exist_ok=True)
    from build_icons import build_icons
    application_icon=build_icons()
    module_cache=BUILD/"swift-cache";module_cache.mkdir(exist_ok=True)
    targets=[("Agent.swift","HotTurkeyAgent",["AppKit","CoreGraphics","IOKit"]),("Desktop.swift","HotTurkey",["AppKit","WebKit","UserNotifications"]),("PeerCheck.swift","HotTurkeyPeerCheck",["Foundation","Security"]),("PolicyClient.swift","HotTurkeyPolicyClient",["Foundation"])]
    targets.append(('SessionAgent.swift','HotTurkeySessionAgent',['AppKit','CoreGraphics','Security']))
    targets.append(('BrowserHost.swift','HotTurkeyBrowserHost',['Foundation','Security']))
    targets.append(('TrackingAgent.swift','HotTurkeyTracker',['AppKit','ApplicationServices','CoreGraphics','ImageIO','UniformTypeIdentifiers']))
    if args.qa:
        targets.extend([("PeerFixture.swift","HotTurkeyPeerFixture",["Foundation"]),("PolicyClient.swift","HotTurkeyPolicyClientQA",["Foundation"])])
        targets.append(('SessionAgent.swift','HotTurkeySessionAgentQA',['AppKit','CoreGraphics','Security']))
        targets.append(('SessionDesktopFixture.swift','HotTurkeySessionDesktopFixture',['AppKit','Security']))
        targets.append(('LoginAppFixture.swift','HotTurkeyLoginAppFixture',['Foundation']))
        targets.append(('RecoveryUIFixture.swift','HotTurkeyRecoveryUIFixture',['AppKit']))
        targets.extend([('BrowserHost.swift','HotTurkeyBrowserHostQA',['Foundation','Security']),('BrowserFixture.swift','HotTurkeyBrowserFixture',['Foundation'])])
        targets.append(('DesktopInterfaceFixture.swift','HotTurkeyInterfaceFixture',['AppKit','WebKit','UserNotifications']))
        targets.append(('DesktopFormsFixture.swift','HotTurkeyFormsFixture',['AppKit','WebKit','UserNotifications']))
        targets.append(('DesktopFilesFixture.swift','HotTurkeyFilesFixture',['AppKit','WebKit','UserNotifications']))
        targets.append(('DesktopTransitionsFixture.swift','HotTurkeyTransitionsFixture',['AppKit','WebKit','UserNotifications']))
        targets.append(('DesktopAppIconsFixture.swift','HotTurkeyIconsFixture',['AppKit','WebKit','UserNotifications']))
        targets.append(('DesktopTrackingFixture.swift','HotTurkeyTrackingFixture',['AppKit','WebKit','UserNotifications']))
    for source,name,frameworks in targets:
        architecture='arm64' if platform.machine() in {'arm64','aarch64'} else 'x86_64'
        command=["/usr/bin/swiftc","-swift-version","5","-target",architecture+'-apple-macos12.0',"-O","-module-cache-path",str(module_cache),str(ROOT/"native"/source),"-o",str(BUILD/name)]
        if source=='TrackingAgent.swift':command.extend(['-parse-as-library','-Xlinker','-weak_framework','-Xlinker','ScreenCaptureKit'])
        if source in {'PolicyClient.swift','SessionAgent.swift','BrowserHost.swift'}:command.append(str(ROOT/'native/LocalPolicySocket.swift'))
        if source in {'SessionAgent.swift','SessionDesktopFixture.swift'}:command.append(str(ROOT/'native/SessionDesktop.swift'))
        if source == 'RecoveryUIFixture.swift':command.extend([str(ROOT/'native/SleepGuardUI.swift'),'-D','QA_RECOVERY'])
        if source in {'Agent.swift','SessionAgent.swift'}:command.append(str(ROOT/'native/SleepGuardUI.swift'))
        if source == 'Desktop.swift':command.extend([str(ROOT/'native'/name) for name in ['DesktopAppearance.swift','DesktopSheet.swift','DesktopStyle.swift','DesktopMenu.swift','DesktopFiles.swift','DesktopAppIcons.swift','DesktopTrackingMedia.swift','DesktopWindow.swift','DesktopLinks.swift']])
        if source in {'DesktopInterfaceFixture.swift','DesktopFormsFixture.swift','DesktopFilesFixture.swift','DesktopTransitionsFixture.swift','DesktopAppIconsFixture.swift','DesktopTrackingFixture.swift'}:command.extend([str(ROOT/'native'/name) for name in ['Desktop.swift','DesktopAppearance.swift','DesktopSheet.swift','DesktopStyle.swift','DesktopMenu.swift','DesktopFiles.swift','DesktopAppIcons.swift','DesktopTrackingMedia.swift','DesktopWindow.swift','DesktopLinks.swift']]+['-D','QA_SHEET'])
        if name in {'HotTurkeyPolicyClientQA','HotTurkeySessionAgentQA','HotTurkeyBrowserHostQA'}:command.extend(['-D','QA'])
        for framework in frameworks:command.extend(["-framework",framework])
        subprocess.run(command,check=True)
        if name!='HotTurkey':
            sign(BUILD/name,runtime=True)
    for name,flags in [('HotTurkeySystemAgent',[])]+([('HotTurkeySystemAgentQA',['-DHOTTURKEY_QA'])] if args.qa else []):
        subprocess.run(['/usr/bin/clang','-fobjc-arc','-O2','-Wall','-Wextra','-Werror','-mmacosx-version-min=12.0','-framework','Foundation','-framework','SystemConfiguration','-framework','IOKit',*flags,str(ROOT/'native/SystemAgent.m'),'-o',str(BUILD/name)],check=True)
        sign(BUILD/name,runtime=True)
    app=BUILD/"Broccoli.app/Contents"
    (app/"MacOS").mkdir(parents=True,exist_ok=True)
    resources=app/"Resources";resources.mkdir(exist_ok=True)
    shutil.copy2(application_icon,resources/'Broccoli.icns')
    shutil.copy2(BUILD/"HotTurkey",app/"MacOS/HotTurkey")
    project=resources/"project"
    project.mkdir(exist_ok=True)
    legacy_package=project/'hotturkey'
    if legacy_package.exists():shutil.rmtree(legacy_package)
    for name in ['README.md','LICENSE']:
        if (ROOT/name).is_file():shutil.copy2(ROOT/name,project/name)
    for folder in ["broccoli","web","extension","scripts","docs"]:
        shutil.copytree(ROOT/folder,project/folder,dirs_exist_ok=True,ignore=shutil.ignore_patterns("__pycache__","*.pyc"))
    (project/'broccoli/uninstall.py').unlink(missing_ok=True)
    (project/"build").mkdir(exist_ok=True)
    shutil.copy2(BUILD/"HotTurkeyAgent",project/"build/HotTurkeyAgent")
    shutil.copy2(BUILD/"HotTurkeyPeerCheck",project/"build/HotTurkeyPeerCheck")
    shutil.copy2(BUILD/"HotTurkeyPolicyClient",project/"build/HotTurkeyPolicyClient")
    shutil.copy2(BUILD/'HotTurkeySystemAgent',project/'build/HotTurkeySystemAgent')
    shutil.copy2(BUILD/'HotTurkeySessionAgent',project/'build/HotTurkeySessionAgent')
    shutil.copy2(BUILD/'HotTurkeyBrowserHost',project/'build/HotTurkeyBrowserHost')
    shutil.copy2(BUILD/'HotTurkeyTracker',project/'build/HotTurkeyTracker')
    python=resources/'python'
    third_party=resources/'ThirdParty/Python'
    if python.exists():shutil.rmtree(python)
    if third_party.exists():shutil.rmtree(third_party)
    if args.system_python:
        (resources/'python-path.txt').write_text(sys.executable)
    else:
        from prepare_runtime import prepare
        prepared=prepare()
        shutil.copytree(prepared/'python',python,symlinks=True)
        third_party.parent.mkdir(exist_ok=True)
        shutil.copytree(prepared/'licenses',third_party)
        shutil.copy2(prepared/'provenance.json',third_party/'provenance.json')
        (resources/'python-path.txt').write_text('python/bin/python3')
        # Python extension modules live outside Frameworks, so sign them explicitly.
        for path in sorted(python.rglob('*')):
            if path.is_symlink() or not path.is_file():continue
            with path.open('rb') as stream:magic=stream.read(4)
            if magic in {b'\xcf\xfa\xed\xfe',b'\xfe\xed\xfa\xcf',b'\xca\xfe\xba\xbe',b'\xbe\xba\xfe\xca'}:
                sign(path,quiet=True)
    info={"CFBundleName":"Broccoli","CFBundleDisplayName":"Broccoli","CFBundleIdentifier":"local.hotturkey.desktop","CFBundleVersion":"35","CFBundleShortVersionString":"0.7.0","CFBundleExecutable":"HotTurkey","CFBundlePackageType":"APPL","LSMinimumSystemVersion":"12.0","NSHighResolutionCapable":True,"NSAppleEventsUsageDescription":"Broccoli uses device rules to log out or shut down your Mac when you configure them.","NSAppTransportSecurity":{"NSAllowsLocalNetworking":True}}
    info['CFBundleIconFile']='Broccoli.icns'
    (app/"Info.plist").write_bytes(plistlib.dumps(info))
    from build_distribution import build_uninstaller,distribution
    build_uninstaller(BUILD/'Broccoli.app')
    embedded_uninstaller=resources/'HotTurkey Uninstaller.app'
    if embedded_uninstaller.exists():shutil.rmtree(embedded_uninstaller)
    # Ad-hoc signing allows local execution; distribution still needs a Developer ID.
    sign(BUILD/"Broccoli.app",deep=True)
    firefox=BUILD/"firefox-extension"
    shutil.copytree(ROOT/"extension",firefox,dirs_exist_ok=True)
    manifest=json.loads((firefox/"manifest.json").read_text())
    manifest["background"]={"scripts":["background.js"]}
    manifest["browser_specific_settings"]={"gecko":{"id":"hotturkey@local.hotturkey","strict_min_version":"128.0","data_collection_permissions":{"required":["none"]}}}
    manifest.pop("incognito",None)
    manifest["permissions"]=[value for value in manifest["permissions"] if value!="favicon"]
    (firefox/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
    if args.qa:
        qa=BUILD/"Broccoli QA.app"
        if qa.exists():shutil.rmtree(qa)
        shutil.copytree(BUILD/"Broccoli.app",qa,symlinks=True)
        qa_info={**info,"CFBundleIdentifier":"local.hotturkey.qa","CFBundleDisplayName":"Broccoli QA","HotTurkeyDataDirectory":str(ROOT/".runtime")}
        (qa/"Contents/Info.plist").write_bytes(plistlib.dumps(qa_info))
        sign(qa,deep=True)
    print("Built:",BUILD/"Broccoli.app")
    print("Browser extension:",ROOT/"extension")
    print('Python runtime:',sys.executable+' (development only)' if args.system_python else 'bundled, relocatable')
    if args.distribution:distribution(BUILD/'Broccoli.app')
    if args.archive:
        archive=BUILD/('HotTurkey-macOS-'+platform.machine()+'.zip')
        subprocess.run(['/usr/bin/ditto','-c','-k','--sequesterRsrc','--keepParent',str(BUILD/'Broccoli.app'),str(archive)],check=True)
        print('Archive:',archive)

if __name__=="__main__":main()
