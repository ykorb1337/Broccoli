"""Shared identities and policy checks for the ordinary setup applications."""
INSTALLER_BUNDLES=frozenset({'com.apple.installer','local.hotturkey.installer','local.hotturkey.uninstaller','local.broccoli.installer','local.broccoli.uninstaller'})
UNINSTALLER_BUNDLE='local.broccoli.uninstaller'

def uninstall_blocked(engine,applications):
    blocks=engine.store.state['blocks']
    if engine.store.state['settings']['block_installer'] and any(engine.locked(b) for b in blocks):
        return '锁定期间已拦截安装器。'
    for block in blocks:
        if engine.active(block) and not engine.break_state(block)['allowed'] and any(engine.app_matches(block,app) for app in applications):
            return '卸载器已被当前规则拦截。'
    return ''
