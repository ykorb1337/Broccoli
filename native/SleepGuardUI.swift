// A recovery surface before/after device sleep. No credential is persisted.
import AppKit

final class RecoveryPanel:NSPanel {
    override var canBecomeKey:Bool { true }
    override var canBecomeMain:Bool { true }
}
final class RecoveryField:NSSecureTextField {
    override func performKeyEquivalent(with event:NSEvent)->Bool {
        if event.modifierFlags.contains(.command),!event.modifierFlags.contains(.option),!event.modifierFlags.contains(.control),let editor=currentEditor() as? NSTextView {
            if event.charactersIgnoringModifiers?.lowercased()=="v" { editor.paste(nil);return true }
            if event.charactersIgnoringModifiers?.lowercased()=="a" { editor.selectAll(nil);return true }
        }
        return super.performKeyEquivalent(with:event)
    }
}
final class RecoveryPlainField:NSTextField {
    override func performKeyEquivalent(with event:NSEvent)->Bool {
        if event.modifierFlags.contains(.command),!event.modifierFlags.contains(.option),!event.modifierFlags.contains(.control),let editor=currentEditor() as? NSTextView {
            if event.charactersIgnoringModifiers?.lowercased()=="v" { editor.paste(nil);return true }
            if event.charactersIgnoringModifiers?.lowercased()=="a" { editor.selectAll(nil);return true }
        }
        return super.performKeyEquivalent(with:event)
    }
}

final class SleepGuardUI:NSObject,NSTextFieldDelegate {
    private static var lastEventPump=Date.distantPast
    private static var applicationPrepared=false
    private static var fullScreenSurface:Bool {
        #if QA_RECOVERY
        return CommandLine.arguments.contains("--full-screen") || Bundle.main.object(forInfoDictionaryKey:"HotTurkeyRecoveryFullScreen") as? Bool==true
        #else
        return true
        #endif
    }
    // These helpers do not call NSApplication.run(). A Foundation run loop
    // services timers, but does not dispatch the AppKit keyboard/mouse queue.
    static func pumpEvents(until deadline:Date) {
        repeat {
            if let app=NSApp {
                var handled=0
                while handled<64,let event=app.nextEvent(matching:.any,until:Date(),inMode:.default,dequeue:true) { app.sendEvent(event);handled+=1 }
                app.updateWindows()
            }
            lastEventPump=Date()
            RunLoop.current.run(until:min(deadline,Date(timeIntervalSinceNow:0.01)))
        } while Date()<deadline
    }
    private var panel:RecoveryPanel?
    private var field:NSTextField?
    private var secureField:RecoveryField?
    private var plainField:RecoveryPlainField?
    private var label:NSTextField?
    private var feedback:NSTextField?
    private var timer:Timer?
    private var state:[String:Any]?
    private var updated=Date.distantPast
    private var pending:String?
    private var otherScreens=[NSWindow]()
    private var endLabel:NSTextField?
    private var screenObserver:NSObjectProtocol?
    private var lastEditing=Date.distantPast
    private var verifying=false
    private var unavailableSince:Date?
    private var unavailableEpisode:[String:Any]?

    override init() {
        super.init()
        screenObserver=NotificationCenter.default.addObserver(forName:NSApplication.didChangeScreenParametersNotification,object:nil,queue:.main) { [weak self] _ in
            guard let self,let value=self.state else { return }
            let stamp=self.updated;self.dismiss();self.render(value,recovery:nil);self.updated=stamp
        }
    }
    deinit { if let observer=screenObserver { NotificationCenter.default.removeObserver(observer) } }

    func takeWord()->String? { let value=pending;pending=nil;return value }
    func controlTextDidChange(_ notification:Notification) { lastEditing=Date() }
    private func inputAvailable()->Bool {
        return panel?.isVisible==true && panel?.isKeyWindow==true && NSApp?.isActive==true && field?.isEditable==true
            && field?.isEnabled==true && field?.currentEditor() != nil && (field?.frame.height ?? 0)>=20
            && field?.isHiddenOrHasHiddenAncestor==false && panel?.firstResponder===field?.currentEditor()
            && Date().timeIntervalSince(Self.lastEventPump)<2
    }
    func readiness()->[String:Any]? {
        if let unavailableEpisode { return unavailableEpisode }
        guard let state,let until=state["until"] as? Double,until>Date().timeIntervalSince1970 else { return nil }
        let available=inputAvailable()
        let composing=(field?.currentEditor() as? NSTextView)?.hasMarkedText()==true
        let quiet=field?.stringValue.isEmpty==true && !composing && !verifying && pending==nil && Date().timeIntervalSince(lastEditing)>=8
        return ["until":until,"action":state["action"] as? String ?? "sleep","ready":available && quiet]
    }
    func canRestrict(_ action:String)->Bool { let value=readiness();return value?["ready"] as? Bool==true && value?["action"] as? String==action }
    @objc private func submit() {
        if (field?.currentEditor() as? NSTextView)?.hasMarkedText()==true { feedback?.stringValue="请先完成输入法选字";return }
        guard let value=field?.stringValue,!value.isEmpty else { return }
        guard value.unicodeScalars.count<=256 else { feedback?.stringValue="安全词最多 256 个字符";return }
        pending=value;verifying=true;secureField?.stringValue="";plainField?.stringValue="";feedback?.stringValue="正在验证安全词…"
    }
    @objc private func toggleVisible(_ sender:NSButton) {
        guard let panel,let secureField,let plainField,!verifying else { return }
        (field?.currentEditor() as? NSTextView)?.unmarkText()
        panel.makeFirstResponder(nil)
        let value=field?.stringValue ?? "",show=sender.state == .on
        secureField.stringValue="";plainField.stringValue=""
        secureField.isHidden=show;plainField.isHidden = !show
        let active:NSTextField=show ? plainField:secureField;active.stringValue=value;field=active;lastEditing=Date()
        panel.contentView?.layoutSubtreeIfNeeded();panel.makeKeyAndOrderFront(nil);panel.makeFirstResponder(active);active.selectText(nil)
        if show { (active.currentEditor() as? NSTextView)?.allowedInputSourceLocales=nil }
    }
    func render(_ value:Any?,recovery:Any?) {
        if let result=recovery as? [String:Any] {
            verifying=false
            if let message=result["error"] as? String { feedback?.stringValue=message;panel?.makeFirstResponder(field);field?.selectText(nil) }
        }
        guard let state=value as? [String:Any],let until=state["until"] as? Double,until>Date().timeIntervalSince1970 else { dismiss();return }
        if let failed=unavailableEpisode,failed["until"] as? Double==until,failed["action"] as? String==state["action"] as? String { return }
        unavailableEpisode=nil
        self.state=state;updated=Date()
        if panel==nil {
            unavailableSince=Date()
            let app=NSApplication.shared
            app.setActivationPolicy(.accessory)
            if !Self.applicationPrepared { app.finishLaunching();Self.applicationPrepared=true }
            let screen=NSScreen.main?.frame ?? NSRect(x:0,y:0,width:1200,height:800)
            #if QA_RECOVERY
            let frame=Self.fullScreenSurface ? screen:NSRect(x:screen.midX-320,y:screen.midY-240,width:640,height:480)
            let window=RecoveryPanel(contentRect:frame,styleMask:.borderless,backing:.buffered,defer:false)
            window.title="HotTurkey Recovery QA"
            #else
            let window=RecoveryPanel(contentRect:screen,styleMask:.borderless,backing:.buffered,defer:false)
            #endif
            window.isReleasedWhenClosed=false
            if Self.fullScreenSurface { window.level = .screenSaver }
            window.collectionBehavior=[.canJoinAllSpaces,.fullScreenAuxiliary]
            window.backgroundColor=NSColor.windowBackgroundColor;window.hidesOnDeactivate=false
            let stack=NSStackView();stack.orientation = .vertical;stack.alignment = .centerX;stack.spacing=12;stack.translatesAutoresizingMaskIntoConstraints=false
            let icon=NSImageView(image:NSImage(systemSymbolName:"moon.fill",accessibilityDescription:nil) ?? NSImage())
            icon.contentTintColor = .secondaryLabelColor
            icon.setAccessibilityElement(false)
            icon.widthAnchor.constraint(equalToConstant:40).isActive=true
            icon.heightAnchor.constraint(equalToConstant:40).isActive=true
            let title=NSTextField(labelWithString:"休息时间");title.font = .systemFont(ofSize:28,weight:.semibold)
            let explanation=NSTextField(wrappingLabelWithString:"限制结束前，唤醒或重新登录仍受限制。\n输入紧急安全词可放行本次时段。")
            explanation.alignment = .center;explanation.font = .systemFont(ofSize:13);explanation.textColor = .secondaryLabelColor
            let countdown=NSTextField(labelWithString:"");countdown.font = .systemFont(ofSize:12);countdown.textColor = .secondaryLabelColor
            let ending=NSTextField(labelWithString:"");ending.font = .systemFont(ofSize:14,weight:.medium)
            let input=RecoveryField(frame:NSRect(x:0,y:0,width:320,height:28));input.placeholderString="输入紧急安全词";input.target=self;input.action=#selector(submit)
            input.isEditable=true;input.isSelectable=true;input.isEnabled=true;input.delegate=self;input.font = .systemFont(ofSize:14)
            (input.cell as? NSTextFieldCell)?.sendsActionOnEndEditing=false
            input.bezelStyle = .roundedBezel
            input.setAccessibilityIdentifier("HotTurkeyRecoveryWord")
            input.setAccessibilityLabel("紧急安全词")
            let plain=RecoveryPlainField(frame:input.frame);plain.placeholderString=input.placeholderString;plain.target=self;plain.action=#selector(submit)
            plain.isEditable=true;plain.isSelectable=true;plain.isEnabled=true;plain.delegate=self;plain.font=input.font;plain.bezelStyle = .roundedBezel;plain.isHidden=true
            (plain.cell as? NSTextFieldCell)?.sendsActionOnEndEditing=false
            plain.setAccessibilityIdentifier("HotTurkeyRecoveryPlainWord");plain.setAccessibilityLabel("紧急安全词")
            let inputBox=NSView();inputBox.translatesAutoresizingMaskIntoConstraints=false
            for view in [input,plain] { view.translatesAutoresizingMaskIntoConstraints=false;inputBox.addSubview(view);NSLayoutConstraint.activate([view.leadingAnchor.constraint(equalTo:inputBox.leadingAnchor),view.trailingAnchor.constraint(equalTo:inputBox.trailingAnchor),view.topAnchor.constraint(equalTo:inputBox.topAnchor),view.bottomAnchor.constraint(equalTo:inputBox.bottomAnchor)]) }
            let show=NSButton(checkboxWithTitle:"显示安全词",target:self,action:#selector(toggleVisible));show.font = .systemFont(ofSize:12)
            show.setAccessibilityIdentifier("HotTurkeyRecoveryShowWord")
            let button=NSButton(title:"放行本次时段",target:self,action:#selector(submit));button.bezelStyle = .rounded;button.keyEquivalent="\r"
            button.setAccessibilityHelp("仅放行当前限制时段，后续计划继续执行。")
            let message=NSTextField(wrappingLabelWithString:"");message.textColor = .secondaryLabelColor;message.font = .systemFont(ofSize:12);message.alignment = .center
            for view in [icon,title,explanation,ending,countdown,inputBox,show,button,message] { stack.addArrangedSubview(view) }
            stack.setCustomSpacing(18,after:icon);stack.setCustomSpacing(20,after:explanation);stack.setCustomSpacing(22,after:countdown)
            let content=window.contentView!;content.addSubview(stack)
            let preferredWidth=stack.widthAnchor.constraint(equalToConstant:440);preferredWidth.priority = .defaultHigh
            let inputWidth=inputBox.widthAnchor.constraint(equalToConstant:320);inputWidth.priority = .defaultHigh
            NSLayoutConstraint.activate([stack.centerXAnchor.constraint(equalTo:content.centerXAnchor),stack.centerYAnchor.constraint(equalTo:content.centerYAnchor),preferredWidth,stack.widthAnchor.constraint(lessThanOrEqualTo:content.widthAnchor,constant:-64),explanation.widthAnchor.constraint(lessThanOrEqualTo:stack.widthAnchor),message.widthAnchor.constraint(lessThanOrEqualTo:stack.widthAnchor),inputWidth,inputBox.widthAnchor.constraint(lessThanOrEqualTo:stack.widthAnchor),inputBox.heightAnchor.constraint(equalToConstant:28)])
            panel=window;field=input;secureField=input;plainField=plain;label=countdown;feedback=message;endLabel=ending
            if Self.fullScreenSurface {
            for display in NSScreen.screens where display.frame != screen {
                let cover=NSWindow(contentRect:display.frame,styleMask:.borderless,backing:.buffered,defer:false)
                cover.isReleasedWhenClosed=false
                cover.level = .screenSaver;cover.collectionBehavior=[.canJoinAllSpaces,.fullScreenAuxiliary];cover.backgroundColor = .windowBackgroundColor
                let note=NSTextField(wrappingLabelWithString:"休息时间\n请在主屏幕输入紧急安全词")
                note.alignment = .center;note.font = .systemFont(ofSize:15);note.textColor = .secondaryLabelColor
                note.translatesAutoresizingMaskIntoConstraints=false;cover.contentView!.addSubview(note)
                NSLayoutConstraint.activate([note.centerXAnchor.constraint(equalTo:cover.contentView!.centerXAnchor),note.centerYAnchor.constraint(equalTo:cover.contentView!.centerYAnchor)])
                cover.orderFrontRegardless();otherScreens.append(cover)
            }
            }
            content.layoutSubtreeIfNeeded();app.activate(ignoringOtherApps:true);window.makeKeyAndOrderFront(nil);window.makeFirstResponder(input);input.selectText(nil)
            timer=Timer.scheduledTimer(withTimeInterval:0.25,repeats:true) { [weak self] _ in self?.tick() }
        }
        tick()
    }
    private func tick() {
        guard let state,let until=state["until"] as? Double else { return }
        // The overlay cannot itself strand the user if the authority is gone.
        guard Date().timeIntervalSince(updated)<=5,until>Date().timeIntervalSince1970 else { dismiss();return }
        // If activation/focus or the AppKit event pump failed, release the
        // covering window and withhold device permission for this episode.
        let focused=inputAvailable()
        if focused { unavailableSince=nil }
        else if unavailableSince==nil { unavailableSince=Date() }
        if let unavailableSince,Date().timeIntervalSince(unavailableSince)>2 {
            unavailableEpisode=["until":until,"action":state["action"] as? String ?? "sleep","ready":false]
            dismiss();return
        }
        let remaining=max(0,(state["grace_remaining"] as? Double ?? 0)-Date().timeIntervalSince(updated))
        let action=["sleep":"睡眠","lock":"锁屏","logout":"注销","shutdown":"关机"][state["action"] as? String ?? "sleep"] ?? "限制使用"
        let formatter=DateFormatter();formatter.dateStyle = .short;formatter.timeStyle = .short
        endLabel?.stringValue="自动恢复于 "+formatter.string(from:Date(timeIntervalSince1970:until))
        label?.stringValue=remaining>0 ? "约 \(Int(ceil(remaining))) 秒后\(action)" : "限制正在生效"
    }
    private func dismiss() { timer?.invalidate();timer=nil;secureField?.stringValue="";plainField?.stringValue="";panel?.close();otherScreens.forEach { $0.close() };otherScreens=[];panel=nil;field=nil;secureField=nil;plainField=nil;label=nil;feedback=nil;endLabel=nil;state=nil;verifying=false;pending=nil;lastEditing=Date.distantPast;unavailableSince=nil }
    #if QA_RECOVERY
    func testStatus()->[String:Any] { return ["visible":panel?.isVisible==true,"active":NSApp?.isActive==true,"key":panel?.isKeyWindow==true,"editor":field?.currentEditor() != nil,"plain":field is RecoveryPlainField,"failed_open":unavailableEpisode != nil] }
    #endif
}
