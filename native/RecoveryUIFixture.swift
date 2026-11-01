// Time-bounded input verification, optionally at production cover level. No device action is linked here.
import AppKit
import Darwin

@main
struct RecoveryUIFixture {
    static func main() {
        guard let output=CommandLine.arguments.count>=2 ? CommandLine.arguments[1] : Bundle.main.object(forInfoDictionaryKey:"HotTurkeyRecoveryProof") as? String else { exit(64) }
        let snapshotsOnly=CommandLine.arguments.contains("--snapshots-only")
        let focusLoss=CommandLine.arguments.contains("--focus-loss")
        let staleParent=CommandLine.arguments.contains("--stale-parent")
        let exercise=CommandLine.arguments.contains("--exercise")
        let fullScreen=CommandLine.arguments.contains("--full-screen") || Bundle.main.object(forInfoDictionaryKey:"HotTurkeyRecoveryFullScreen") as? Bool==true
        alarm(fullScreen ? 35:100)
        let surface=SleepGuardUI(),until=Date().timeIntervalSince1970+300
        let deadline=Date(timeIntervalSinceNow:fullScreen ? 30:90)
        var proof:[String:Any] = ["physical_device_actions":false,"installed_rules_changed":false,"passed":false,"full_screen_surface":fullScreen]
        func writeProof() {
            if let data=try? JSONSerialization.data(withJSONObject:proof,options:.prettyPrinted) {
                try? data.write(to:URL(fileURLWithPath:output),options:.atomic)
            }
        }
        let started=Date()
        var captured=false,withdrewFocus=false
        var focusProbe:NSWindow?
        var nextProof=Date.distantPast
        while Date()<deadline {
            if !staleParent || !captured { surface.render(["until":until,"action":"sleep","grace_remaining":30.0],recovery:nil) }
            SleepGuardUI.pumpEvents(until:Date(timeIntervalSinceNow:0.05))
            if Date()>nextProof { proof["current_ui"]=surface.testStatus();writeProof();nextProof=Date(timeIntervalSinceNow:0.5) }
            if !captured,Date().timeIntervalSince(started)>0.3,let window=NSApp.windows.first(where:{$0.title=="HotTurkey Recovery QA"}),let content=window.contentView {
                let original=window.appearance
                for (name,appearance) in [("light",NSAppearance.Name.aqua),("dark",.darkAqua)] {
                    window.appearance=NSAppearance(named:appearance);content.layoutSubtreeIfNeeded();content.displayIfNeeded()
                    window.effectiveAppearance.performAsCurrentDrawingAppearance {
                        if let bitmap=content.bitmapImageRepForCachingDisplay(in:content.bounds) {
                            content.cacheDisplay(in:content.bounds,to:bitmap)
                            let canvas=NSImage(size:content.bounds.size);canvas.lockFocus()
                            window.backgroundColor.setFill();NSBezierPath.fill(content.bounds)
                            let foreground=NSImage(size:content.bounds.size);foreground.addRepresentation(bitmap)
                            foreground.draw(in:content.bounds,from:.zero,operation:.sourceOver,fraction:1);canvas.unlockFocus()
                            let image=URL(fileURLWithPath:output).deletingPathExtension().appendingPathExtension(name+".png")
                            if let data=canvas.tiffRepresentation,let rendered=NSBitmapImageRep(data:data),let png=rendered.representation(using:.png,properties:[:]) {
                                do{try png.write(to:image);proof["\(name)_snapshot_written"]=true}catch{proof["\(name)_snapshot_written"]=false}
                            }
                        }
                    }
                }
                window.appearance=original
                func fields(_ view:NSView)->[NSSecureTextField] { (view as? NSSecureTextField).map{[$0]} ?? view.subviews.flatMap(fields) }
                if let field=fields(content).first {
                    let frame=field.convert(field.bounds,to:content)
                    proof["recovery_field_visible_and_editable"]=content.bounds.contains(frame)&&frame.height>=28&&field.isEnabled&&field.isEditable&&field.currentEditor() != nil
                    proof["recovery_field_has_accessible_name"]=field.accessibilityLabel()=="紧急安全词"
                }
                captured=true
                proof["borderless_production_style"]=window.styleMask == .borderless
                proof["production_cover_level"]=window.level == .screenSaver
                proof["production_full_screen_geometry"]=NSScreen.screens.contains{$0.frame==window.frame}
                proof["healthy_input_reports_ready"]=surface.readiness()?["ready"] as? Bool==true
                writeProof()
                if snapshotsOnly {
                    proof["mode"]="layout_only";proof["keyboard_submission_verified"]=false
                    proof["passed"]=proof["recovery_field_visible_and_editable"] as? Bool==true&&proof["recovery_field_has_accessible_name"] as? Bool==true&&proof["light_snapshot_written"] as? Bool==true&&proof["dark_snapshot_written"] as? Bool==true
                    surface.render(nil,recovery:nil);writeProof();exit(proof["passed"] as? Bool==true ? 0:1)
                }
            }
            if captured,focusLoss,!withdrewFocus {
                let other=NSWindow(contentRect:NSRect(x:80,y:80,width:320,height:120),styleMask:[.titled],backing:.buffered,defer:false)
                other.title="Recovery focus probe";other.isReleasedWhenClosed=false;other.makeKeyAndOrderFront(nil);focusProbe=other;withdrewFocus=true
            }
            if captured,exercise,let window=NSApp.windows.first(where:{$0.title=="HotTurkey Recovery QA"}),let content=window.contentView {
                func descendants(_ view:NSView)->[NSView] { [view]+view.subviews.flatMap(descendants) }
                let views=descendants(content)
                if let hidden=views.compactMap({$0 as? NSSecureTextField}).first,let secureEditor=hidden.currentEditor() as? NSTextView,
                   let show=views.compactMap({$0 as? NSButton}).first(where:{$0.title=="显示安全词"}) {
                    secureEditor.insertText("qa-key-47",replacementRange:NSRange(location:0,length:secureEditor.string.utf16.count))
                    proof["secure_editor_accepts_text"]=hidden.stringValue=="qa-key-47"
                    proof["editing_withholds_permission"]=surface.canRestrict("sleep")==false
                    show.performClick(nil)
                    if let plain=views.compactMap({$0 as? RecoveryPlainField}).first,let editor=plain.currentEditor() as? NSTextView {
                        proof["toggle_preserves_text_and_focus"]=plain.stringValue=="qa-key-47"&&window.firstResponder===editor
                        editor.setMarkedText("验证",selectedRange:NSRange(location:2,length:0),replacementRange:NSRange(location:0,length:editor.string.utf16.count))
                        proof["composition_withholds_permission"]=editor.hasMarkedText()&&surface.canRestrict("sleep")==false
                        editor.unmarkText();editor.insertText("验证安全词47",replacementRange:NSRange(location:0,length:editor.string.utf16.count))
                        proof["plain_editor_accepts_unicode"]=plain.stringValue=="验证安全词47"
                        views.compactMap{$0 as? NSButton}.first(where:{$0.title=="放行本次时段"})?.performClick(nil)
                        proof["unicode_submission_received"]=surface.takeWord()=="验证安全词47"
                    }
                }
                proof["mode"]="component_editing"
                let required=["recovery_field_visible_and_editable","secure_editor_accepts_text","editing_withholds_permission","toggle_preserves_text_and_focus","composition_withholds_permission","plain_editor_accepts_unicode","unicode_submission_received"]
                proof["passed"]=required.allSatisfy{proof[$0] as? Bool==true};surface.render(nil,recovery:nil);writeProof();exit(proof["passed"] as? Bool==true ? 0:1)
            }
            if captured,(focusLoss || staleParent),Date().timeIntervalSince(started)>(focusLoss ? 3.5:6.5) {
                proof["mode"]=focusLoss ? "focus_loss":"stale_parent"
                proof["unavailable_input_cannot_restrict"]=surface.canRestrict("sleep")==false
                proof["cover_released"]=NSApp.windows.filter{$0.title=="HotTurkey Recovery QA"}.allSatisfy{!$0.isVisible}
                proof["failure_episode_latched"]=surface.testStatus()["failed_open"] as? Bool==true
                proof["passed"]=proof["recovery_field_visible_and_editable"] as? Bool==true&&proof["cover_released"] as? Bool==true&&proof["unavailable_input_cannot_restrict"] as? Bool==true
                focusProbe?.close()
                surface.render(nil,recovery:nil);writeProof();exit(proof["passed"] as? Bool==true ? 0:1)
            }
            if let value=surface.takeWord() {
                proof["typed_word_received"]=value=="qa-key-47"
                proof["unicode_word_received"]=value=="验证安全词47"
                proof["typing_prevents_device_action"]=surface.canRestrict("sleep")==false
                surface.render(nil,recovery:nil)
                let passed=(value=="qa-key-47" || value=="验证安全词47")&&proof["recovery_field_visible_and_editable"] as? Bool==true&&proof["recovery_field_has_accessible_name"] as? Bool==true
                proof["passed"]=passed;writeProof();exit(passed ? 0:1)
            }
        }
        surface.render(nil,recovery:nil);proof["error"]="No test word submitted before the automatic test exit";writeProof();exit(2)
    }
}
