import AppKit

final class SetupDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var window: NSWindow!
    let chinese = Locale.preferredLanguages.first?.hasPrefix("zh") == true
    var removing: Bool {
#if BROCCOLI_UNINSTALLER
        return true
#else
        return false
#endif
    }
    let primary = NSButton(title: "", target: nil, action: nil)
    let secondary = NSButton(title: "", target: nil, action: nil)
    let message = NSTextField(wrappingLabelWithString: "")
    let detail = NSTextField(wrappingLabelWithString: "")
    let password = NSSecureTextField()
    let spinner = NSProgressIndicator()
    var worker: Process?
    var succeeded = false
    func text(_ zh: String, _ en: String) -> String { chinese ? zh : en }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        let menu=NSMenu();let appItem=NSMenuItem();let appMenu=NSMenu()
        appMenu.addItem(withTitle:text("退出", "Quit"),action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q")
        appItem.submenu=appMenu;menu.addItem(appItem);NSApp.mainMenu=menu
        window=NSWindow(contentRect:NSRect(x:0,y:0,width:560,height:360),styleMask:[.titled,.closable,.miniaturizable],backing:.buffered,defer:false)
        window.title=removing ? text("卸载 Broccoli", "Uninstall Broccoli") : text("安装 Broccoli", "Install Broccoli")
        window.delegate=self;window.titlebarAppearsTransparent=true;window.isReleasedWhenClosed=false
        let content=NSView();window.contentView=content
        let icon=NSImageView();icon.image=Bundle.main.url(forResource:"Broccoli",withExtension:"icns").flatMap{NSImage(contentsOf:$0)}
        icon.translatesAutoresizingMaskIntoConstraints=false;icon.widthAnchor.constraint(equalToConstant:64).isActive=true;icon.heightAnchor.constraint(equalToConstant:64).isActive=true
        NSApp.applicationIconImage=icon.image
        let title=NSTextField(labelWithString:window.title);title.font = .systemFont(ofSize:25,weight:.semibold)
        let subtitle=NSTextField(wrappingLabelWithString:removing ? text("移除应用和后台，保留规则、统计与截图。", "Remove the app and background service. Keep your rules, statistics and screenshots.") : text("将应用与后台安装到此 Mac。", "Install the app and its background service on this Mac."))
        subtitle.font = .systemFont(ofSize:13);subtitle.textColor = .secondaryLabelColor
        let heading=NSStackView(views:[title,subtitle]);heading.orientation = .vertical;heading.alignment = .leading;heading.spacing=7
        let header=NSStackView(views:[icon,heading]);header.orientation = .horizontal;header.spacing=16;header.alignment = .centerY
        let box=NSBox();box.boxType = .custom;box.borderType = .lineBorder;box.cornerRadius=10;box.borderColor = .separatorColor;box.fillColor = .controlBackgroundColor;box.contentViewMargins=NSSize(width:16,height:14)
        let location=NSTextField(labelWithString:text("位置", "Location"));location.font = .systemFont(ofSize:13)
        let path=NSTextField(labelWithString:"~/Applications");path.font = .systemFont(ofSize:13);path.textColor = .secondaryLabelColor;path.isSelectable=true
        let row=NSStackView(views:[location,NSView(),path]);row.orientation = .horizontal
        detail.font = .systemFont(ofSize:12);detail.textColor = .secondaryLabelColor
        let boxContent=NSStackView(views:[row,detail]);boxContent.orientation = .vertical;boxContent.alignment = .leading;boxContent.spacing=10;boxContent.translatesAutoresizingMaskIntoConstraints=false
        box.contentView?.addSubview(boxContent)
        if let inside=box.contentView { NSLayoutConstraint.activate([boxContent.leadingAnchor.constraint(equalTo:inside.leadingAnchor),boxContent.trailingAnchor.constraint(equalTo:inside.trailingAnchor),boxContent.topAnchor.constraint(equalTo:inside.topAnchor),boxContent.bottomAnchor.constraint(equalTo:inside.bottomAnchor),row.widthAnchor.constraint(equalTo:boxContent.widthAnchor)]) }
        password.placeholderString=text("设置密码", "Settings password");password.font = .systemFont(ofSize:13);password.bezelStyle = .roundedBezel;password.isHidden=true
        password.heightAnchor.constraint(equalToConstant:28).isActive=true
        message.font = .systemFont(ofSize:12);message.textColor = .secondaryLabelColor
        spinner.style = .spinning;spinner.controlSize = .small;spinner.isDisplayedWhenStopped=false
        let status=NSStackView(views:[spinner,message]);status.orientation = .horizontal;status.alignment = .centerY;status.spacing=8
        let stack=NSStackView(views:[header,box,password,status]);stack.orientation = .vertical;stack.alignment = .leading;stack.spacing=22;stack.translatesAutoresizingMaskIntoConstraints=false;content.addSubview(stack)
        for view in [header,box,password,status] { view.widthAnchor.constraint(equalTo:stack.widthAnchor).isActive=true }
        primary.title=removing ? text("卸载", "Uninstall") : text("安装", "Install");primary.bezelStyle = .rounded;primary.keyEquivalent="\r";primary.target=self;primary.action=#selector(proceed);primary.isEnabled=false
        if removing { primary.hasDestructiveAction=true }
        secondary.title=text("取消", "Cancel");secondary.bezelStyle = .rounded;secondary.keyEquivalent="\u{1b}";secondary.target=self;secondary.action=#selector(close)
        let actions=NSStackView(views:[secondary,primary]);actions.orientation = .horizontal;actions.spacing=8;actions.translatesAutoresizingMaskIntoConstraints=false;content.addSubview(actions)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo:content.leadingAnchor,constant:30),stack.trailingAnchor.constraint(equalTo:content.trailingAnchor,constant:-30),stack.topAnchor.constraint(equalTo:content.topAnchor,constant:30),actions.trailingAnchor.constraint(equalTo:content.trailingAnchor,constant:-24),actions.bottomAnchor.constraint(equalTo:content.bottomAnchor,constant:-20),stack.bottomAnchor.constraint(lessThanOrEqualTo:actions.topAnchor,constant:-20)])
        window.center();window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)
        inspect()
    }
    func paths() -> (URL,URL,URL) {
        let resources=Bundle.main.resourceURL!
        let app=removing ? Bundle.main.bundleURL : resources.appendingPathComponent("payload/Broccoli.app")
        let base=removing ? resources : app.appendingPathComponent("Contents/Resources")
        return (base.appendingPathComponent("python/bin/python3"),base.appendingPathComponent("project"),app)
    }
    func request(_ action:String, completion:@escaping([String:Any])->Void) {
        guard worker==nil else{return};let (python,project,source)=paths();let process=Process();let output=Pipe();let input=Pipe()
        process.executableURL=python;process.arguments=["-E","-s","-B","-m","broccoli.setup",action,"--source",source.path];process.currentDirectoryURL=project
        process.environment=ProcessInfo.processInfo.environment.merging(["PATH":"/usr/bin:/bin:/usr/sbin:/sbin"]){_,new in new}
        process.standardOutput=output;process.standardError=FileHandle.nullDevice;process.standardInput=input
        let payload=(try? JSONSerialization.data(withJSONObject:["password":password.stringValue])) ?? Data("{}".utf8)
        worker=process;spinner.startAnimation(nil);primary.isEnabled=false;secondary.isEnabled=false
        do { try process.run();input.fileHandleForWriting.write(payload);try? input.fileHandleForWriting.close()
            DispatchQueue.global(qos:.userInitiated).async {
                let data=output.fileHandleForReading.readDataToEndOfFile();process.waitUntilExit()
                let value=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any] ?? ["ok":false,"error":self.text("无法完成操作，请重试。", "Unable to complete the operation. Please try again.")]
                DispatchQueue.main.async { self.worker=nil;self.spinner.stopAnimation(nil);self.secondary.isEnabled=true;completion(value) }
            }
        } catch { worker=nil;spinner.stopAnimation(nil);secondary.isEnabled=true;completion(["ok":false,"error":error.localizedDescription]) }
    }
    func inspect() {
        message.stringValue=text("正在检查…", "Checking…")
        request("inspect") { result in
            if let error=result["error"] as? String { self.failure(error);return }
            let installed=result["installed"] as? Bool == true
            self.password.isHidden=result["requires_password"] as? Bool != true
            self.detail.stringValue=installed ? self.text("已安装版本 ", "Installed version ")+(result["version"] as? String ?? "") : self.text("此账户尚未安装 Broccoli。", "Broccoli is not installed for this account.")
            if self.removing && !installed { self.message.stringValue=self.text("无需卸载。", "Nothing to uninstall.");self.secondary.title=self.text("完成", "Done");return }
            if self.removing && result["uninstall_blocked"] as? Bool == true { self.failure(result["reason"] as? String ?? "");self.primary.isEnabled=false;return }
            self.primary.title=self.removing ? self.text("卸载", "Uninstall") : installed ? self.text("更新", "Update") : self.text("安装", "Install")
            self.message.stringValue="";self.primary.isEnabled=true
        }
    }
    func failure(_ value:String) { message.stringValue=value;message.textColor = .systemRed;primary.isEnabled=true }
    @objc func proceed() {
        if succeeded {
            if !removing { NSWorkspace.shared.open(FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications/Broccoli.app")) }
            NSApp.terminate(nil);return
        }
        if removing {
            let alert=NSAlert();alert.messageText=text("卸载 Broccoli？", "Uninstall Broccoli?");alert.informativeText=text("应用和后台将停止运行。本地数据会保留。", "The app and background service will stop. Local data will be kept.");alert.addButton(withTitle:text("卸载", "Uninstall"));alert.addButton(withTitle:text("取消", "Cancel"))
            if alert.runModal() != .alertFirstButtonReturn {return}
        }
        message.textColor = .secondaryLabelColor;message.stringValue=removing ? text("正在卸载…", "Uninstalling…") : text("正在安装…", "Installing…")
        request(removing ? "uninstall" : "install") { result in
            self.password.stringValue=""
            guard result["ok"] as? Bool == true else {self.failure(result["error"] as? String ?? self.text("操作失败。", "Operation failed."));return}
            self.succeeded=true;self.password.isHidden=true;self.message.textColor = .secondaryLabelColor;self.message.stringValue=self.removing ? self.text("已卸载，本地数据已保留。", "Uninstalled. Local data has been kept.") : self.text("安装完成。", "Installation complete.")
            self.primary.title=self.removing ? self.text("完成", "Done") : self.text("打开 Broccoli", "Open Broccoli");self.primary.hasDestructiveAction=false;self.primary.isEnabled=true;self.secondary.isHidden=true
        }
    }
    @objc func close(){if worker==nil {NSApp.terminate(nil)}}
    func windowShouldClose(_ sender:NSWindow)->Bool {worker==nil}
    func applicationShouldTerminate(_ sender:NSApplication)->NSApplication.TerminateReply {worker==nil ? .terminateNow : .terminateCancel}
    func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool {true}
}
let setupApp=NSApplication.shared
let setupDelegate=SetupDelegate();setupApp.delegate=setupDelegate;setupApp.run()
