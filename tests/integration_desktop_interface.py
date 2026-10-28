"""A real window and WebKit, isolated rules, no installed app or executor.

Requires the macOS GUI session and build/HotTurkeyInterfaceFixture from --qa.
The fixture bundle deliberately has no backend runtime to start on disconnect.
"""
import argparse
import json
import plistlib
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from hotturkey.server import Service


def validate_proof(proof):
    required={f'{page}_{mode}_layout' for page in ['overview','blocks','schedule','statistics','settings']
              for mode in ['light','dark','dark_200']}
    required.update({f'{page}_{mode}_input_labels' for page in ['overview','blocks','schedule','statistics','settings'] for mode in ['light','dark','dark_200']})
    required.update(['calendar_events_readable_and_keyboard_focusable','all_eight_lock_methods_render','compact_lock_sheet','confirmation_attached_to_editor',
        'draft_retained_across_tabs','editor_name_focused','file_picker_attached_to_editor','inactive_rule_saved',
        'large_text_actions_visible','large_text_sheet_bounded','lock_sheet_dark_large_text_controls_visible',
        'locked_state_forms_and_available_actions','menu_text_size_updates_immediately',
        'native_close_restores_main_webview','native_redo_edits_web_field','native_undo_edits_web_field',
        'new_disabled_during_sheet','new_menu_opens_editor_from_settings','real_appkit_sheet',
        'save_restores_main_webview','standard_redo_shortcut','standard_services_and_window_menus',
        'synthetic_accessibility_styles','system_theme_clears_window_override',
        'light_appkit_palette_and_symbols','dark_appkit_palette_and_symbols','large_text_appkit_palette_and_symbols',
        'status_text_light_contrast','status_text_dark_contrast','status_text_dark_200_contrast'])
    assert proof['passed'],proof.get('error')
    assert required.issubset(proof['checks']),sorted(required-set(proof['checks']))
    assert all(value is True for value in proof['checks'].values()),proof['checks']


def validate_forms_proof(proof):
    required={f'{name}_{profile}_{kind}' for name in ['device','schedule','break-sessions','break-text','import','sources','category','emergency','recovery','settings-password','challenge','setup','locked-additions','authentication']
              for profile in ['light','dark','dark-200'] for kind in ['state','layout','label_associations']}
    required.update(['source_selection_restores_keyboard_focus','native_cancel_returns_to_editor_draft',
        'nested_cancel_keeps_native_sheet','return_saves_ordinary_editor','all_seven_break_forms_render','segmented_arrow_navigation_retains_focus',
        'schedule_validation_error','validation_scrolls_error_into_view','return_does_not_save_device_plan',
        'device_remember_word_validation_preserved','device_plan_saved_inactive_in_isolated_backend',
        'configured_recovery_word_state','password_protection_hides_new_controls','password_protection_disables_native_new',
        'authentication_focus','return_authenticates_and_restores_native_new','synthetic_readonly_hides_new_controls',
        'synthetic_readonly_disables_native_new','weekday_label_toggles_only_its_own_day','range_lock_weekday_labels_are_independent'])
    assert proof['passed'],proof.get('error')
    assert required.issubset(proof['checks']),sorted(required-set(proof['checks']))
    assert all(value is True for value in proof['checks'].values()),proof['checks']


def validate_files_proof(proof):
    required={'native_save_panel_from_actual_export','native_menus_disabled_during_file_sheet',
        'exported_json_round_trip','export_survives_blob_url_revocation','export_cancel_writes_no_file',
        'native_import_cancel_resolves_page_promise','native_import_reads_selected_json','imported_rules_remain_inactive',
        'export_attaches_to_editor_sheet','import_attaches_to_editor_and_retains_draft',
        'atomic_replace_preserves_permissions','failed_export_preserves_existing_file','no_partial_exports_left'}
    assert proof['passed'],proof.get('error')
    assert required.issubset(proof['checks']),sorted(required-set(proof['checks']))
    assert all(value is True for value in proof['checks'].values()),proof['checks']


def validate_transitions_proof(proof):
    required={f'{page}_{profile}_{check}' for page in ['blocks','schedule']
              for profile in ['light','dark','dark_200'] for check in ['first_frame_protected','pending_frame_stays_covered','editor_ready_before_uncover','main_page_restored']}
    required.update(['cancelled_transition_cannot_uncover_next_sheet','stalled_editor_uses_bounded_existing_fallback',
        'toolbar_has_single_creation_menu','creation_menu_has_two_explicit_choices','rule_groups_are_distinct_and_complete',
        'sleep_search_hides_empty_other_groups','clearing_search_restores_groups','blocks_sleep_menu_opens_inactive_wizard',
        'schedule_sleep_menu_opens_inactive_wizard','readonly_creation_menu_disabled','readonly_menu_cannot_open_wizard'])
    assert proof['passed'],proof.get('error')
    assert required.issubset(proof['checks']),sorted(required-set(proof['checks']))
    assert all(value is True for value in proof['checks'].values()),proof['checks']


def main():
    parser=argparse.ArgumentParser()
    modes=parser.add_mutually_exclusive_group()
    modes.add_argument('--forms',action='store_true',help='Audit form sheets and keyboard/input behavior')
    modes.add_argument('--files',action='store_true',help='Audit real native file panels and file transfers')
    modes.add_argument('--transitions',action='store_true',help='Audit the first visible editor frame from both toolbar plus buttons')
    args=parser.parse_args()
    kind='transitions' if args.transitions else 'files' if args.files else 'forms' if args.forms else 'interface'
    binary=ROOT/'build'/f'HotTurkey{kind.title()}Fixture'
    assert binary.is_file(),'Build the interface fixture first with scripts/build.py --qa'
    with tempfile.TemporaryDirectory(dir='/private/tmp',prefix='ht-interface-') as temporary:
        directory=Path(temporary);output=directory/'build';output.mkdir()
        service=Service(directory/'data',enforce=False)
        first=service.engine.save_block({'name':'深度工作','enabled':True,'websites':['video.invalid','news.invalid'],
            'applications':['bundle:local.hotturkey.fixture-game'],'break':{'type':'pomodoro','work_minutes':25,'break_minutes':5}})
        service.engine.set_lock(first['id'],{'type':'timer','until':time.time()+5400})
        service.engine.save_block({'name':'阅读与学习','enabled':True,'websites':['social.invalid']})
        service.engine.save_block({'name':'每周学习计划','mode':'scheduled','enabled':True,'color':'#af52de','websites':['stream.invalid'],
            'schedule':[{'days':[0,1,2,3,4],'start':540,'end':720},{'days':[0,1,2,3,4],'start':840,'end':1020}]})
        service.engine.save_block({'name':'休息日','enabled':False,'websites':['games.invalid']})
        if args.transitions:
            service.engine.save_block({'name':'睡眠计划演示','device':'sleep','enabled':False,'confirm_device':True})
            service.engine.save_block({'name':'其他设备限制演示','device':'lock','enabled':False,'confirm_device':True})
        for day in range(7):
            for target,target_kind,seconds in [('docs.example.invalid','website',2200+day*170),('视频课程','application',1600-day*100),('news.example.invalid','website',800+day*100)]:
                service.store.event(time.time()-day*86400-3600,'演示账户',target_kind,target,first['id'],seconds=seconds,blocked=day%2==0)
        thread=threading.Thread(target=service.http.serve_forever);thread.start()
        try:
            app=directory/f'HotTurkey {kind.title()} QA.app';contents=app/'Contents'
            executable=contents/'MacOS/HotTurkey';executable.parent.mkdir(parents=True);shutil.copy2(binary,executable)
            resources=contents/'Resources';resources.mkdir();(resources/'project').mkdir()
            (resources/'python-path.txt').write_text('')
            info={'CFBundleName':f'HotTurkey {kind.title()} QA','CFBundleDisplayName':f'HotTurkey {kind.title()} QA','CFBundleIdentifier':f'local.hotturkey.{kind}-qa',
                  'CFBundleExecutable':'HotTurkey','CFBundlePackageType':'APPL','CFBundleVersion':'1',
                  'LSMinimumSystemVersion':'12.0','NSHighResolutionCapable':True,
                  'NSAppTransportSecurity':{'NSAllowsLocalNetworking':True},
                  'HotTurkeyDataDirectory':str(service.store.directory)}
            icon=ROOT/'build/HotTurkey.icns'
            if icon.is_file():
                shutil.copy2(icon,resources/icon.name);info['CFBundleIconFile']=icon.name
            (contents/'Info.plist').write_bytes(plistlib.dumps(info))
            subprocess.run(['/usr/bin/codesign','--force','--sign','-',str(app)],check=True,capture_output=True)
            subprocess.run(['/usr/bin/codesign','--verify','--deep','--strict',str(app)],check=True,capture_output=True)
            command=['/usr/bin/open','-W','-n','-a',str(app),'--args',str(directory)] if args.files else [str(executable),str(directory)]
            result=subprocess.run(command,capture_output=True,text=True,timeout=560 if args.files else 100)
            desktop_log=service.store.directory/'desktop.log'
            if desktop_log.exists():shutil.copy2(desktop_log,ROOT/'build'/f'native-{kind}-desktop.log')
            if args.files:
                for source in [output/'native-files-phase.txt',service.store.directory/'desktop.log']:
                    if source.exists():shutil.copy2(source,ROOT/'build'/('native-files-'+source.name))
                (ROOT/'build/native-files-process.log').write_text(result.stderr[-6000:]+result.stdout[-2000:])
            assert result.returncode==0,f'Interface fixture exited {result.returncode}: {result.stderr[-2000:]}'
            proof=json.loads((output/(f'native-{kind}-proof.json' if kind!='interface' else 'native-sheet-proof.json')).read_text())
            proof.update(real_appkit_window=True,real_webkit=True,system_preferences_changed=False,
                         isolated_backend=True,installed_application_changed=False)
            build=ROOT/'build';build.mkdir(exist_ok=True)
            (build/f'native-{kind}-proof.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2))
            for screenshot in output.glob('*.png'):shutil.copy2(screenshot,build/screenshot.name)
            if args.transitions:validate_transitions_proof(proof)
            elif args.files:validate_files_proof(proof)
            elif args.forms:validate_forms_proof(proof)
            else:validate_proof(proof)
            print(json.dumps(proof,ensure_ascii=False))
        finally:
            service.http.shutdown();service.http.server_close();thread.join(timeout=5)
            service.store.db.close();service.singleton.close()
            assert not thread.is_alive()


if __name__=='__main__':main()
