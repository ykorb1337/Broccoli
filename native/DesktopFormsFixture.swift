import AppKit
import WebKit
import Darwin

/// Own-application UI integration tests. The driver provides an isolated backend
/// with enforcement disabled; this fixture never runs a power or executor API.
@MainActor final class FormsQA {
    let d: Delegate
    let output: URL
    let unique = "Forms QA " + String(UUID().uuidString.prefix(8))
    var checks: [String: Bool] = [:]
    init(_ delegate: Delegate, root: String) {
        d = delegate; output = URL(fileURLWithPath: root).appendingPathComponent("build")
    }
    func fail(_ message: String) -> NSError { NSError(domain: "HotTurkey.FormsQA", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    func pause(_ seconds: Double = 0.35) async throws { try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }
    @discardableResult func js(_ body: String) async throws -> Any? {
        try await d.web.callAsyncJavaScript(body, arguments: [:], in: nil, contentWorld: .page)
    }
    func wait(_ message: String, _ condition: @escaping () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(8)
        while !condition() { if Date() > deadline { throw fail(message) }; try await pause(0.05) }
    }
    func waitJS(_ expression: String) async throws {
        let deadline = Date().addingTimeInterval(8)
        while (try await js("return Boolean(\(expression));")) as? Bool != true {
            if Date() > deadline { throw fail("Waiting for \(expression)") }; try await pause(0.06)
        }
    }
    func check(_ expression: String, _ name: String) async throws {
        guard (try await js("return Boolean(\(expression));")) as? Bool == true else { throw fail(name) }
        checks[name] = true
    }
    func panel() async throws {
        try await wait("Native form panel did not appear") { self.d.window.attachedSheet != nil }
        try await waitJS("modal.open")
        try await pause()
    }
    func close() async throws {
        try await js("closeModal();")
        try await wait("Form panel did not close") { self.d.window.attachedSheet == nil && self.d.web.window === self.d.window }
    }
    func capture(_ name: String) async throws {
        let image: NSImage = try await withCheckedThrowingContinuation { continuation in
            d.web.takeSnapshot(with: nil) { image, error in
                if let image { continuation.resume(returning: image) }
                else { continuation.resume(throwing: error ?? self.fail("Snapshot failed")) }
            }
        }
        guard let data = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: data),
              let png = bitmap.representation(using: .png, properties: [:]) else { throw fail("Could not encode snapshot") }
        try png.write(to: output.appendingPathComponent("Form-\(name).png"))
    }
    func layout(_ name: String) async throws {
        try await check(#"""
        (()=>{
            const footer=document.querySelector('.modal-footer').getBoundingClientRect();
            const controls=[...modal.querySelectorAll('input,select,textarea,button')].filter(el=>el.getBoundingClientRect().width);
            return footer.top>=0&&footer.bottom<=innerHeight+2&&footer.right<=innerWidth+2&&
                controls.every(el=>{const r=el.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1;});
        })()
        """#, name)
        try await check(#"""
        (()=>{
            const visible=[...modal.querySelectorAll('input,select,textarea')].filter(el=>el.getBoundingClientRect().width);
            window.__unnamedControls=visible.filter(el=>!el.getAttribute('aria-label')?.trim()&&!el.getAttribute('aria-labelledby')?.trim()&&![...el.labels||[]].some(label=>label.textContent.trim())).map(el=>el.id||el.name||el.tagName);
            return !modal.querySelector('label label')&&window.__unnamedControls.length===0;
        })()
        """#, name.replacingOccurrences(of: "_layout", with: "_label_associations"))
    }
    func run() async throws {
        try await wait("Application did not load") { self.d.nativeChromeInstalled && self.d.navigationFinished }
        try await waitJS("Object.keys(categories).length>0")
        try await js("deviceWizard();")
        try await panel()
        try await check(#"""
        (()=>{
            const inputs=[...modal.querySelectorAll('[name=device-day]')],before=inputs.map(input=>input.checked);
            inputs[2].labels[0].click();
            return inputs.every((input,index)=>input.checked===(index===2?!before[index]:before[index]))&&inputs.every(input=>input.labels.length===1)&&modal.querySelector('[role=group][aria-label="重复日期"]')!==null;
        })()
        """#, "weekday_label_toggles_only_its_own_day")
        try await close()
        try await js("lockModal(state.blocks.find(block=>block.name==='阅读与学习').id);const type=document.querySelector('#lock-type');type.value='range';type.dispatchEvent(new Event('change',{bubbles:true}));")
        try await panel()
        try await check(#"""
        (()=>{
            const inputs=[...modal.querySelectorAll('[name=lock-day]')];inputs[1].labels[0].click();
            return !modal.querySelector('label label')&&inputs.every((input,index)=>input.checked===(index!==1))&&inputs.every(input=>input.labels.length===1&&input.getAttribute('aria-label'));
        })()
        """#, "range_lock_weekday_labels_are_independent")
        try await close()
        let scenarios: [(String, String, String)] = [
            ("device", "deviceWizard();", "document.querySelector('#device-name')===document.activeElement&&!document.querySelector('#device-enabled').checked&&!document.querySelector('#device-word-confirmed').checked"),
            ("schedule", "editBlock();intervalModal(null,1,540,720);document.querySelector('#span-custom').checked=true;document.querySelector('#span-custom').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[name=\"span.type\"]').value='pomodoro';document.querySelector('[name=\"span.type\"]').dispatchEvent(new Event('change',{bubbles:true}));", "document.querySelector('[name=\"span.work_minutes\"]')!==null"),
            ("break-sessions", "editBlock();editor.break.type='sessions';tab='break';renderEditor();", "document.querySelector('[name=\"break.sessions\"]')!==null"),
            ("break-text", "editBlock();editor.break.type='text';tab='break';renderEditor();", "document.querySelector('[name=\"break.custom_text\"]')!==null"),
            ("import", "importDraft=Array.from({length:60},(_,i)=>({name:'导入计划 '+(i+1),websites:['site.invalid'],device:i%10?'none':'sleep',autostart:i%3?{type:'none'}:{type:'daily'}}));renderRuleImport();", "document.querySelector('.modal-content').scrollTop<2&&document.querySelectorAll('.sheet-list-row').length===60&&!document.querySelector('#import-keep-autostart').checked&&document.querySelector('.modal-content').scrollHeight>document.querySelector('.modal-content').clientHeight"),
            ("sources", "editBlock();openBlockImport();", "document.querySelectorAll('[name=block-import]').length>0&&document.querySelector('[data-action=apply-block-import]').disabled"),
            ("category", "editBlock();await action('category',{dataset:{}});", "document.querySelectorAll('[data-action=select-category]').length===Object.keys(categories).length"),
            ("emergency", "await action('device-emergency',{dataset:{}});", "document.activeElement.id==='device-emergency-word'&&!document.querySelector('#device-stop-plan').checked"),
            ("recovery", "await action('device-recovery-configure',{dataset:{}});", "document.activeElement.id==='recovery-new'"),
            ("settings-password", "await action('settings-password',{dataset:{}});", "document.activeElement.id==='new-settings-password'&&modal.dataset.kind==='compact'"),
            ("challenge", "if(!window.__formsBreakID){window.__formsBreakID=(await api('blocks/save',{block:{...newBlock(),name:'文本休息演示',enabled:true,websites:['break.invalid'],break:{...newBlock().break,type:'text',custom_text:'focus fixture',break_minutes:1}}})).id;await refresh(false);}await action('break',{dataset:{id:window.__formsBreakID}});", "document.activeElement.id==='break-answer'&&document.querySelector('.challenge').textContent==='focus fixture'"),
            ("setup", "await setup();", "document.querySelector('.setup-list')!==null&&document.querySelector('[data-action=install-backend]')!==null"),
            ("locked-additions", "editBlock(state.blocks.find(b=>b.locked).id);", "document.activeElement.name==='append_websites'&&document.querySelector('[data-action=add-targets]')!==null"),
            ("authentication", "await action('authenticate',{dataset:{}});", "document.activeElement.id==='auth-password'&&modal.dataset.kind==='compact'")
        ]
        for (profile, theme, scale) in [("light", "light", 100), ("dark", "dark", 100), ("dark-200", "dark", 200)] {
            try await js("await api('settings',{theme:'\(theme)',text_scale:\(scale)});await refresh(false);")
            for (name, setup, expected) in scenarios {
                try await js(setup); try await panel()
                try await check(expected, "\(name)_\(profile)_state")
                try await layout("\(name)_\(profile)_layout")
                try await capture("\(name)-\(profile)")
                try await close()
            }
        }
        try await js("await api('settings',{theme:'light',text_scale:100});await refresh(false);editBlock();document.querySelector('#editor-name').value='\(unique)';document.querySelector('[name=websites]').value='kept.invalid';openBlockImport();")
        try await panel()
        let original = d.window.attachedSheet
        try await js("const input=document.querySelector('[name=block-import]:not(:disabled)');window.__formsSource=input.value;input.focus();input.click();")
        try await pause()
        try await check("document.activeElement.name==='block-import'&&document.activeElement.value===window.__formsSource&&document.activeElement.checked", "source_selection_restores_keyboard_focus")
        d.window.attachedSheet?.cancelOperation(nil)
        try await waitJS("document.querySelector('#editor-name')!==null")
        try await check("document.querySelector('#editor-name').value==='\(unique)'&&document.querySelector('[name=websites]').value==='kept.invalid'", "native_cancel_returns_to_editor_draft")
        guard original === d.window.attachedSheet else { throw fail("Nested cancel replaced sheet") }
        checks["nested_cancel_keeps_native_sheet"] = true
        try await js("document.querySelector('#editor-name').focus();document.querySelector('#editor-name').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));")
        try await wait("Return did not save editor") { self.d.window.attachedSheet == nil }
        try await waitJS("state.blocks.some(b=>b.name==='\(unique)'&&!b.enabled)")
        checks["return_saves_ordinary_editor"] = true
        try await js("editBlock();tab='break';renderEditor();const expected={none:null,pomodoro:'work_minutes',allowance:'allowance_minutes',reward:'work_minutes',text:'custom_text',delay:'delay_minutes',sessions:'sessions'};window.__formsBreaks=Object.entries(expected).every(([mode,field])=>{const select=document.querySelector('[name=\"break.type\"]');select.value=mode;select.dispatchEvent(new Event('change',{bubbles:true}));return !field||Boolean(document.querySelector('[name=\"break.'+field+'\"]'));});")
        try await panel(); try await check("window.__formsBreaks", "all_seven_break_forms_render")
        try await js("const selected=document.querySelector('.tabs .active');selected.focus();selected.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));")
        try await pause()
        try await check("document.activeElement.dataset.tab==='other'&&document.activeElement.getAttribute('aria-selected')==='true'", "segmented_arrow_navigation_retains_focus")
        try await close()
        try await js("editBlock();intervalModal(null,0);document.querySelectorAll('[name=span-day]').forEach(el=>el.checked=false);")
        try await panel()
        try await js("document.querySelector('[data-action=save-interval]').click();");try await pause()
        try await check("document.querySelector('#modal-error').textContent.includes('请至少选择一天')", "schedule_validation_error")
        try await check("(()=>{const e=document.querySelector('#modal-error').getBoundingClientRect(),r=document.querySelector('.modal-content').getBoundingClientRect();return e.top>=r.top-2&&e.bottom<=r.bottom+2;})()", "validation_scrolls_error_into_view")
        try await capture("schedule-error-light"); try await close()
        try await js("deviceWizard();window.__formsBefore=(await api('state')).blocks.length;document.querySelector('#device-name').focus();document.querySelector('#device-name').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));")
        try await panel()
        try await check("(await api('state')).blocks.length===window.__formsBefore", "return_does_not_save_device_plan")
        try await js("document.querySelector('[data-action=save-device]').click();")
        try await pause()
        try await check("document.querySelector('#modal-error').textContent.includes('请先确认已记住')", "device_remember_word_validation_preserved")
        try await capture("device-error-light")
        try await js("document.querySelector('#device-word').value='fixture-only-safe-word';document.querySelector('#device-word-repeat').value='fixture-only-safe-word';document.querySelector('#device-word-confirmed').checked=true;document.querySelector('[data-action=save-device]').click();")
        try await wait("Inactive device plan was not saved") { self.d.window.attachedSheet == nil }
        try await waitJS("state.blocks.some(b=>b.device==='sleep'&&!b.enabled)")
        checks["device_plan_saved_inactive_in_isolated_backend"] = true
        try await js("deviceWizard();")
        try await panel(); try await check("document.querySelector('#device-word')===null&&!document.querySelector('#device-enabled').checked", "configured_recovery_word_state")
        try await capture("device-configured-light"); try await close()
        try await js("await api('settings',{password:'fixture-auth-word'});await refresh();document.querySelector('nav [data-page=blocks]').click();")
        try await wait("Password protected menu stayed enabled") { !self.d.appearance.canCreate }
        try await check("!state.authenticated&&!document.querySelector('#header-actions [data-action=new]')", "password_protection_hides_new_controls")
        checks["password_protection_disables_native_new"] = true
        try await js("await action('authenticate',{dataset:{}});")
        try await panel()
        try await check("document.activeElement.id==='auth-password'", "authentication_focus")
        try await js("document.querySelector('#auth-password').value='fixture-auth-word';document.querySelector('#auth-password').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));")
        try await wait("Authentication did not close") { self.d.window.attachedSheet == nil }
        try await wait("Authenticated menu did not become enabled") { self.d.appearance.canCreate }
        checks["return_authenticates_and_restores_native_new"] = true
        try await js("state.can_manage=false;renderPage();")
        try await wait("Read-only menu stayed enabled") { !self.d.appearance.canCreate }
        try await check("!document.querySelector('#header-actions [data-action=new]')", "synthetic_readonly_hides_new_controls")
        checks["synthetic_readonly_disables_native_new"] = true
    }
    func finish(_ error: Error? = nil) {
        let proof: [String: Any] = ["passed": error == nil, "checks": checks,
            "error": error?.localizedDescription ?? "", "enforcement": false,
            "formal_data_changed": false, "physical_device_actions": false, "system_preferences_changed": false]
        if let data = try? JSONSerialization.data(withJSONObject: proof, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: output.appendingPathComponent("native-forms-proof.json"))
        }
        d.appearance.cancelEditor(); NSApp.terminate(nil)
    }
}
@main @MainActor enum FormsFixture {
    static func main() {
        alarm(90)
        let app = NSApplication.shared, delegate = Delegate()
        app.setActivationPolicy(.regular); app.delegate = delegate
        DesktopMenu.install(delegate: delegate)
        let qa = FormsQA(delegate, root: CommandLine.arguments[1])
        Task { @MainActor in
            do { try await qa.run(); qa.finish() }
            catch { qa.finish(error) }
        }
        withExtendedLifetime((qa, delegate)) { app.run() }
    }
}
