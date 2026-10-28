import AppKit
import WebKit
import Darwin

@MainActor final class FilesQA {
    let d: Delegate
    let output: URL
    var checks: [String: Bool] = [:]
    init(_ d: Delegate, root: String) { self.d=d;output=URL(fileURLWithPath:root).appendingPathComponent("build") }
    func phase(_ name:String){try? name.write(to:output.appendingPathComponent("native-files-phase.txt"),atomically:true,encoding:.utf8)}
    func error(_ message:String)->NSError {NSError(domain:"HotTurkey.FilesQA",code:1,userInfo:[NSLocalizedDescriptionKey:message])}
    func pause(_ seconds:Double=0.25) async throws {try await Task.sleep(nanoseconds:UInt64(seconds*1_000_000_000))}
    @discardableResult func js(_ body:String) async throws -> Any? {try await d.web.callAsyncJavaScript(body,arguments:[:],in:nil,contentWorld:.page)}
    func wait(_ message:String,timeout:Double=8,_ condition:@escaping()->Bool) async throws {
        let end=Date().addingTimeInterval(timeout)
        while !condition(){
            if Date()>end{
                let details=(try? await js("return JSON.stringify({modalOpen:modal.open,toast:document.querySelector('#toast')?.textContent,error:document.querySelector('#modal-error')?.textContent});")) as? String ?? "No page diagnostics"
                throw error("\(message): \(details)")
            };try await pause(0.05)
        }
    }
    func waitJS(_ expression:String,timeout:Double=8) async throws {
        let end=Date().addingTimeInterval(timeout)
        while (try await js("return Boolean(\(expression));")) as? Bool != true {
            if Date()>end{
                let details=(try? await js("return JSON.stringify({modalOpen:modal.open,importCount:importDraft?.length,toast:document.querySelector('#toast')?.textContent,error:document.querySelector('#modal-error')?.textContent});")) as? String ?? "No page diagnostics"
                throw error("Waiting for \(expression): \(details)")
            };try await pause(0.06)
        }
    }
    func savePanel(_ parent:NSWindow) async throws -> NSSavePanel {
        try await wait("Native export panel missing") {parent.attachedSheet is NSSavePanel}
        guard let panel=parent.attachedSheet as? NSSavePanel,!(panel is NSOpenPanel) else{throw error("Wrong export panel type")}
        return panel
    }
    func openPanel(_ parent:NSWindow) async throws -> NSOpenPanel {
        try await wait("Native import panel missing") {parent.attachedSheet is NSOpenPanel}
        return parent.attachedSheet as! NSOpenPanel
    }
    func run() async throws {
        try await wait("Application did not load"){self.d.nativeChromeInstalled&&self.d.navigationFinished}
        try await waitJS("state?.authenticated===true")
        let before=(try await js("return state.blocks.length;")) as! Int
        d.fileDialogs.initialDirectory=output
        phase("request_export")
        try await js("await action('export',{dataset:{}});")
        phase("export_js_returned")
        _=try await savePanel(d.window)
        phase("save_panel_seen")
        checks["native_save_panel_from_actual_export"]=true
        guard !d.appearance.canNavigate else{throw error("Navigation active under save panel")}
        checks["native_menus_disabled_during_file_sheet"]=true
        // The page revokes its Blob URL after one second. An active download
        // must continue to work while the person is choosing a destination.
        try await pause(1.4);phase("await_export_click")
        let exported=output.appendingPathComponent("hotturkey-blocks.json")
        try await wait("Export file was not written",timeout:240){FileManager.default.fileExists(atPath:exported.path)}
        phase("export_file_written")
        let data=try Data(contentsOf:exported)
        let value=try JSONSerialization.jsonObject(with:data) as! [String:Any]
        guard let blocks=value["blocks"] as? [[String:Any]],blocks.count==before,blocks.contains(where:{$0["name"] as? String=="深度工作"}) else{throw error("Export content mismatch")}
        checks["exported_json_round_trip"]=true
        checks["export_survives_blob_url_revocation"]=true
        try await wait("Export panel remained open"){self.d.window.attachedSheet==nil}
        phase("request_cancelled_export")
        try await js("download('cancelled.json',{fixture:true});")
        let cancelled=try await savePanel(d.window)
        cancelled.cancel(nil)
        try await wait("Cancelled export did not dismiss"){self.d.window.attachedSheet==nil};try await pause()
        guard !FileManager.default.fileExists(atPath:output.appendingPathComponent("cancelled.json").path) else{throw error("Cancelled export wrote a file")}
        checks["export_cancel_writes_no_file"]=true
        // Exercise the real HTML file-input delegate and cancel event.
        phase("request_cancelled_import")
        try await js("window.__fileCancelled=false;readFile('.json').then(value=>window.__fileCancelled=value===null);")
        let cancelledOpen=try await openPanel(d.window);cancelledOpen.cancel(nil)
        try await waitJS("window.__fileCancelled===true")
        checks["native_import_cancel_resolves_page_promise"]=true
        phase("request_import_roundtrip")
        try await js("document.querySelector('nav [data-page=blocks]').click();document.querySelector('[data-action=import]').click();")
        _=try await openPanel(d.window)
        phase("await_import_click")
        try await waitJS("modal.open&&importDraft?.length===\(before)",timeout:240)
        guard d.window.attachedSheet != nil else{throw error("Import preview is not a native sheet")}
        checks["native_import_reads_selected_json"]=true
        try await js("document.querySelector('[data-action=confirm-import]').click();")
        try await wait("Import preview did not close"){self.d.window.attachedSheet==nil}
        try await waitJS("state.blocks.length===\(before*2)")
        guard (try await js("return state.blocks.slice(\(before)).every(block=>!block.enabled);")) as? Bool==true else{throw error("Imported rules were enabled")}
        checks["imported_rules_remain_inactive"]=true
        // Files opened from inside an editor must remain attached to it.
        try await js("editBlock();document.querySelector('#editor-name').value='Retained file draft';")
        try await wait("Editor did not open"){self.d.window.attachedSheet != nil}
        let editor=d.window.attachedSheet!
        try await js("download('inside.txt','fixture text','text/plain');")
        let nestedSave=try await savePanel(editor);nestedSave.cancel(nil)
        try await wait("Nested export remained open"){editor.attachedSheet==nil}
        guard d.window.attachedSheet===editor else{throw error("Nested export lost editor")}
        checks["export_attaches_to_editor_sheet"]=true
        try await js("window.__nestedCancelled=false;readFile('.txt').then(value=>window.__nestedCancelled=value===null);")
        let nestedOpen=try await openPanel(editor);nestedOpen.cancel(nil)
        try await waitJS("window.__nestedCancelled===true")
        guard (try await js("return document.querySelector('#editor-name').value==='Retained file draft';")) as? Bool==true else{throw error("File chooser lost draft")}
        checks["import_attaches_to_editor_and_retains_draft"]=true
        try await js("closeModal();")
        try await wait("Editor did not close"){self.d.window.attachedSheet==nil}
        let destination=output.appendingPathComponent("existing.json"),replacement=output.appendingPathComponent("replacement.part")
        try Data("old".utf8).write(to:destination)
        try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:destination.path)
        try Data("new".utf8).write(to:replacement)
        try DesktopFiles.commit(temporary:replacement,destination:destination)
        guard try Data(contentsOf:destination)==Data("new".utf8),!FileManager.default.fileExists(atPath:replacement.path) else{throw error("Atomic replacement failed")}
        let mode=try FileManager.default.attributesOfItem(atPath:destination.path)[.posixPermissions] as! NSNumber
        guard mode.intValue==0o600 else{throw error("Replacement changed permissions")}
        checks["atomic_replace_preserves_permissions"]=true
        var refused=false
        do {try DesktopFiles.commit(temporary:replacement,destination:destination)} catch {refused=true}
        guard refused,try Data(contentsOf:destination)==Data("new".utf8) else{throw error("Failed export destroyed existing file") }
        checks["failed_export_preserves_existing_file"]=true
        guard try FileManager.default.contentsOfDirectory(at:output,includingPropertiesForKeys:nil).allSatisfy({!$0.lastPathComponent.hasPrefix(".hotturkey-export-")}) else{throw error("Partial export leaked")}
        checks["no_partial_exports_left"]=true
    }
    func finish(_ failure:Error?=nil){
        let proof:[String:Any] = ["passed":failure==nil,"error":failure?.localizedDescription ?? "","checks":checks,
            "enforcement":false,"formal_data_changed":false,"physical_device_actions":false,"system_preferences_changed":false]
        if let data=try? JSONSerialization.data(withJSONObject:proof,options:[.prettyPrinted,.sortedKeys]){try? data.write(to:output.appendingPathComponent("native-files-proof.json"))}
        d.fileDialogs?.cancelAll();d.appearance.cancelEditor();NSApp.terminate(nil)
    }
}
@main @MainActor enum FilesFixture {
    static func main(){
        alarm(540)
        let app=NSApplication.shared,delegate=Delegate();app.setActivationPolicy(.regular);app.delegate=delegate
        DesktopMenu.install(delegate:delegate)
        let qa=FilesQA(delegate,root:CommandLine.arguments[1])
        Task { @MainActor in do{try await qa.run();qa.finish()}catch{qa.finish(error)} }
        withExtendedLifetime((qa,delegate)){app.run()}
    }
}
