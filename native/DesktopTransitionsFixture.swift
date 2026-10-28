import AppKit
import WebKit
import Darwin

/// Real native toolbar/sheet transitions against the driver's inert backend.
@MainActor final class TransitionsQA {
    let d: Delegate
    let output: URL
    var checks: [String: Bool] = [:]
    var firstFrameProtected = false
    init(_ d: Delegate, root: String) { self.d=d; output=URL(fileURLWithPath:root).appendingPathComponent("build") }
    func failure(_ message: String) -> NSError { NSError(domain:"HotTurkey.TransitionsQA",code:1,userInfo:[NSLocalizedDescriptionKey:message]) }
    func pause(_ seconds: Double = 0.05) async throws { try await Task.sleep(nanoseconds:UInt64(seconds*1_000_000_000)) }
    @discardableResult func js(_ body: String) async throws -> Any? { try await d.web.callAsyncJavaScript(body,arguments:[:],in:nil,contentWorld:.page) }
    func wait(_ message: String, _ condition: () -> Bool) async throws {
        let end=Date().addingTimeInterval(8)
        while !condition() {
            if Date()>end {
                let state=(try? await js("return JSON.stringify({modal:modal.open,nativeSheets:window.HotTurkeyNativeSheets,focused:document.activeElement.id});")) as? String ?? "unavailable"
                throw failure("\(message); active=\(NSApp.isActive), sheet=\(d.window.attachedSheet != nil), cover=\(cover() != nil), page=\(state)")
            };try await pause()
        }
    }
    func waitJS(_ expression: String) async throws {
        let end=Date().addingTimeInterval(8)
        while (try await js("return Boolean(\(expression));")) as? Bool != true {
            if Date()>end { throw failure(expression) }; try await pause()
        }
    }
    func cover() -> NSView? { d.window.attachedSheet?.contentView?.subviews.first { $0.accessibilityIdentifier()=="HotTurkeyEditorRenderCover" } }
    func openFromToolbar(_ action: String = "new") async throws {
        // A real toolbar click activates the app; match that before exercising
        // WebKit animation frames, which are throttled for background windows.
        d.show()
        try await wait("Test window did not activate") { NSApp.isActive && self.d.window.isKeyWindow }
        try await wait("Toolbar plus unavailable") { self.d.window.toolbar?.items.first { $0.itemIdentifier.rawValue=="new" }?.isEnabled==true }
        let item=d.window.toolbar!.items.first { $0.itemIdentifier.rawValue=="new" }!
        firstFrameProtected=false
        guard let entry=(item as? NSMenuToolbarItem)?.menu.items.first(where:{$0.representedObject as? String==action}),
              NSApp.sendAction(entry.action!,to:entry.target,from:entry) else { throw failure("Native creation menu action failed") }
        try await wait("Sheet did not present") { self.d.window.attachedSheet != nil }
    }
    func close() async throws {
        d.window.attachedSheet?.performClose(nil)
        try await wait("Sheet did not close") { self.d.window.attachedSheet==nil && self.d.web.window===self.d.window }
        try await waitJS("!modal.open&&!document.documentElement.classList.contains('native-sheet')")
        try await wait("Navigation did not resume after closing") { self.d.appearance.canNavigate }
    }
    func ready(_ field: String = "editor-name") async throws {
        try await wait("Editor remained covered") { self.d.window.attachedSheet != nil && self.cover()==nil }
        try await waitJS("modal.open&&document.activeElement.id==='\(field)'&&getComputedStyle(document.querySelector('main')).display==='none'")
    }
    func capture(_ name: String) async throws {
        let image: NSImage = try await withCheckedThrowingContinuation { continuation in
            d.web.takeSnapshot(with: nil) { image, error in
                if let image { continuation.resume(returning: image) }
                else { continuation.resume(throwing: error ?? self.failure("Snapshot failed")) }
            }
        }
        guard let data=image.tiffRepresentation,let bitmap=NSBitmapImageRep(data:data),let png=bitmap.representation(using:.png,properties:[:]) else { throw failure("Snapshot encoding failed") }
        try png.write(to:output.appendingPathComponent(name+".png"))
    }
    func run() async throws {
        try await wait("Application did not load") { self.d.nativeChromeInstalled && self.d.navigationFinished }
        d.appearance.sheetChanged = { [weak self] shown in
            guard let self, shown, let content=self.d.window.attachedSheet?.contentView,let cover=self.cover() else { return }
            self.firstFrameProtected = cover.isOpaque && !cover.isHidden && cover.frame==content.bounds && content.subviews.last===cover
        }
        let web=d.web!
        guard let creation=d.window.toolbar?.items.first(where:{$0.itemIdentifier.rawValue=="new"}) as? NSMenuToolbarItem,
              creation.action==nil,!d.window.toolbar!.items.contains(where:{$0.itemIdentifier.rawValue=="new-device"}) else { throw failure("Toolbar still has a separate sleep button") }
        checks["toolbar_has_single_creation_menu"]=true
        guard creation.menu.items.map(\.title)==["新建拦截规则","新建睡眠计划"] else { throw failure("Creation choices unclear") }
        checks["creation_menu_has_two_explicit_choices"]=true
        d.appearance.showPage("blocks")
        try await waitJS("document.body.dataset.view==='blocks'&&document.querySelector('[data-rule-kind=sleep]')!==null")
        try await waitJS("(()=>{const groups=[...document.querySelectorAll('.rule-group')];const ids=groups.flatMap(group=>[...group.querySelectorAll('.card-main [data-action=edit]')].map(button=>button.dataset.id));return groups.length===3&&ids.length===state.blocks.length&&new Set(ids).size===ids.length&&groups.every(group=>[...group.querySelectorAll('.card-main [data-action=edit]')].every(button=>{const device=state.blocks.find(block=>block.id===button.dataset.id).device;return group.dataset.ruleKind===(device==='sleep'?'sleep':device==='none'?'targets':'device');}));})()")
        checks["rule_groups_are_distinct_and_complete"]=true
        try await js("document.querySelector('#block-filter').value='睡眠计划演示';document.querySelector('#block-filter').dispatchEvent(new Event('input',{bubbles:true}));")
        try await waitJS("document.querySelectorAll('.rule-group').length===1&&document.querySelector('[data-rule-kind=sleep]')!==null")
        checks["sleep_search_hides_empty_other_groups"]=true
        try await js("document.querySelector('#block-filter').value='';document.querySelector('#block-filter').dispatchEvent(new Event('input',{bubbles:true}));")
        try await waitJS("document.querySelectorAll('.rule-group').length===3")
        checks["clearing_search_restores_groups"]=true
        for page in ["blocks","schedule"] {
            d.appearance.showPage(page);try await waitJS("document.body.dataset.view==='\(page)'")
            try await openFromToolbar("new-device");try await ready("device-name")
            try await waitJS("!document.querySelector('#device-enabled').checked&&!document.querySelector('#device-word-confirmed').checked")
            checks["\(page)_sleep_menu_opens_inactive_wizard"]=true
            try await close()
        }
        for (profile,theme,scale) in [("light","light",100),("dark","dark",100),("dark_200","dark",200)] {
            try await js("await api('settings',{theme:'\(theme)',text_scale:\(scale)});await refresh(false);")
            for page in ["blocks","schedule"] {
                d.appearance.showPage(page)
                try await waitJS("document.body.dataset.view==='\(page)'")
                if page=="blocks" { try await capture("Rule-groups-\(profile)") }
                // Delay animation callbacks to exercise the gap between sheet
                // presentation and WebKit's first editor frame.
                try await js("window.__transitionRAF=requestAnimationFrame;window.requestAnimationFrame=callback=>window.__transitionRAF(time=>setTimeout(()=>callback(time),120));")
                try await openFromToolbar()
                guard firstFrameProtected else { throw failure("Inherited \(page) frame exposed at sheet presentation") }
                checks["\(page)_\(profile)_first_frame_protected"]=true
                try await pause(0.08)
                guard cover() != nil else { throw failure("Editor uncovered before delayed frame callbacks") }
                checks["\(page)_\(profile)_pending_frame_stays_covered"]=true
                try await ready()
                guard d.web===web else { throw failure("WebView replaced") }
                checks["\(page)_\(profile)_editor_ready_before_uncover"]=true
                try await js("window.requestAnimationFrame=window.__transitionRAF;delete window.__transitionRAF;")
                try await close()
                try await waitJS("document.body.dataset.view==='\(page)'&&getComputedStyle(document.querySelector('main')).display!=='none'")
                checks["\(page)_\(profile)_main_page_restored"]=true
            }
        }
        try await js("await api('settings',{theme:'light',text_scale:100});await refresh(false);window.__transitionRAF=requestAnimationFrame;window.requestAnimationFrame=callback=>window.__transitionRAF(time=>setTimeout(()=>callback(time),120));")
        try await openFromToolbar(); try await close()
        try await openFromToolbar(); try await pause(0.08)
        guard firstFrameProtected, cover() != nil else { throw failure("Cancelled transition uncovered a later editor") }
        checks["cancelled_transition_cannot_uncover_next_sheet"]=true
        try await ready(); try await js("window.requestAnimationFrame=window.__transitionRAF;delete window.__transitionRAF;");try await close()
        // A stalled renderer must still take the bounded existing fallback.
        try await js("window.__transitionRAF=requestAnimationFrame;window.requestAnimationFrame=callback=>callback.name==='decorate'?window.__transitionRAF(callback):0;")
        try await openFromToolbar()
        try await waitJS("window.HotTurkeyNativeSheets===false&&modal.open")
        guard d.window.attachedSheet==nil,d.web.window===d.window else { throw failure("Stalled editor did not restore the main WebView") }
        checks["stalled_editor_uses_bounded_existing_fallback"]=true
        try await js("window.requestAnimationFrame=window.__transitionRAF;delete window.__transitionRAF;closeModal();window.HotTurkeyNativeSheets=true;")
        try await waitJS("!modal.open")
        try await js("state.can_manage=false;renderPage();")
        try await wait("Readonly permissions did not reach toolbar") { !self.d.appearance.canCreate }
        creation.menu.update()
        guard creation.menu.items.allSatisfy({!$0.isEnabled}) else { throw failure("Readonly creation menu still enabled") }
        checks["readonly_creation_menu_disabled"]=true
        let sleep=creation.menu.items[1];_ = NSApp.sendAction(sleep.action!,to:sleep.target,from:sleep)
        try await pause(0.2)
        guard d.window.attachedSheet==nil else { throw failure("Readonly menu opened a wizard") }
        checks["readonly_menu_cannot_open_wizard"]=true
    }
    func finish(_ error: Error? = nil) {
        let proof: [String:Any] = ["passed":error==nil,"checks":checks,"error":error?.localizedDescription ?? "","enforcement":false,"formal_data_changed":false,"physical_device_actions":false]
        if let data=try? JSONSerialization.data(withJSONObject:proof,options:[.prettyPrinted,.sortedKeys]) { try? data.write(to:output.appendingPathComponent("native-transitions-proof.json")) }
        d.appearance.cancelEditor();NSApp.terminate(nil)
    }
}
@main @MainActor enum TransitionsFixture {
    static func main() {
        alarm(90)
        let app=NSApplication.shared,d=Delegate();app.setActivationPolicy(.regular);app.delegate=d;DesktopMenu.install(delegate:d)
        let qa=TransitionsQA(d,root:CommandLine.arguments[1])
        Task { @MainActor in do { try await qa.run();qa.finish() } catch { qa.finish(error) } }
        withExtendedLifetime((qa,d)) { app.run() }
    }
}
