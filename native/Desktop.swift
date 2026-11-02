import AppKit
import WebKit
import UserNotifications

final class Delegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, UNUserNotificationCenterDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var status: NSStatusItem!
    var service: Process?
    var base: URL!
    var dataDirectory: URL!
    var notices: NSObjectProtocol?
    var sleepNotices: NSObjectProtocol?
    var retries = 0
    var loadingLabel: NSTextField!
    var navigationGeneration = 0
    var navigationRecoveries = 0
    var navigationRecoveryPending = false
    var navigationFinished = false
    var currentNavigation: WKNavigation?
    var installation: Process?
    var trackingPermissionProcess: Process?
    var connectionPending = false
    var systemMode = false
    let appearance = DesktopAppearance()
    var initialWindowFrame: NSRect?
    var nativeChromeInstalled = false
    var fileDialogs: DesktopFiles!
    private var desktopIconLoaded = false
    let applicationIcons = DesktopAppIcons()
    let trackingMedia = DesktopTrackingMedia()
    var activeOrigin: URL?
    private var activeToken: String?
    private var trackingMediaGeneration = 0
    var filePresentationWindow: NSWindow? {
        if let viewer=trackingMedia.viewer,viewer.isKeyWindow { return viewer }
        if let editor=appearance.presentationWindow,editor !== window { return editor }
        return window
    }
    let probeSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.connectionProxyDictionary = [:]
        return URLSession(configuration:config)
    }()
    func applicationDidFinishLaunching(_ notification: Notification) {
        let resources = Bundle.main.resourceURL!
        if let url=Bundle.main.url(forResource:"Broccoli",withExtension:"icns"),let icon=NSImage(contentsOf:url),icon.isValid {
            NSApp.applicationIconImage=icon
            desktopIconLoaded=true
        }
        base = resources.appendingPathComponent("project")
        if let override = Bundle.main.object(forInfoDictionaryKey:"HotTurkeyDataDirectory") as? String {
            dataDirectory = URL(fileURLWithPath:override)
        } else {
            dataDirectory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/HotTurkey")
        }
        systemMode = CommandLine.arguments.contains("--system") || Bundle.main.object(forInfoDictionaryKey:"HotTurkeySystemMode") as? Bool == true
        if systemMode { dataDirectory = dataDirectory.appendingPathComponent("system-desktop") }
        try? FileManager.default.createDirectory(at:dataDirectory,withIntermediateDirectories:true)
        if desktopIconLoaded { desktopLog("application icon loaded") }
        appearance.sheetChanged = { [weak self] shown in self?.desktopLog(shown ? "editor sheet presented" : "editor sheet dismissed") }
        let menu = NSMenu()
        menu.addItem(withTitle:"打开 Broccoli",action:#selector(show),keyEquivalent:"")
        menu.addItem(NSMenuItem.separator())
        menu.addItem(withTitle:"关闭窗口（后台继续）",action:#selector(hide),keyEquivalent:"")
        menu.addItem(withTitle:"退出界面（后台继续）",action:#selector(quit),keyEquivalent:"")
        status = NSStatusBar.system.statusItem(withLength:NSStatusItem.variableLength)
        status.button?.image = NSImage(systemSymbolName:"leaf.fill",accessibilityDescription:"Broccoli")
        status.menu = menu
        let config = WKWebViewConfiguration()
#if QA_SHEET
        config.websiteDataStore = .nonPersistent()
#endif
        config.userContentController.add(self,name:"native")
        config.userContentController.addUserScript(WKUserScript(source:"window.HotTurkeyNativeShell = true; window.HotTurkeyNativeSheets = true; document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('native-shell'));",injectionTime:.atDocumentStart,forMainFrameOnly:true))
        web = WKWebView(frame:.zero,configuration:config)
        web.navigationDelegate = self
        web.uiDelegate = self
        window = NSWindow(contentRect:NSRect(x:0,y:0,width:1590,height:1100),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false)
        window.minSize = NSSize(width:920,height:650)
        window.title = "Broccoli"
        window.contentView = web
        fileDialogs = DesktopFiles(parent: { [weak self] in self?.filePresentationWindow },
                                   event: { [weak self] in self?.desktopLog($0) })
        appearance.web = web
        loadingLabel = NSTextField(labelWithString:"正在连接本地后台…")
        loadingLabel.font = NSFont.systemFont(ofSize:17)
        loadingLabel.textColor = .secondaryLabelColor
        loadingLabel.translatesAutoresizingMaskIntoConstraints = false
        web.addSubview(loadingLabel)
        NSLayoutConstraint.activate([loadingLabel.centerXAnchor.constraint(equalTo:web.centerXAnchor),loadingLabel.centerYAnchor.constraint(equalTo:web.centerYAnchor)])
        if let screen=window.screen ?? NSScreen.main {
            let frame=DesktopWindowLayout.frame(in:screen.visibleFrame);initialWindowFrame=frame
            window.minSize=NSSize(width:min(920,frame.width),height:min(650,frame.height));window.setFrame(frame,display:false)
        } else { window.center() }
        window.isReleasedWhenClosed = false
        UNUserNotificationCenter.current().delegate = self
        notices = DistributedNotificationCenter.default().addObserver(forName:NSNotification.Name("local.hotturkey.notice"),object:nil,queue:.main) { note in
            let content = UNMutableNotificationContent(); content.title = "Broccoli"; content.body = note.object as? String ?? ""
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier:UUID().uuidString,content:content,trigger:nil))
        }
        sleepNotices = DistributedNotificationCenter.default().addObserver(forName:NSNotification.Name("local.hotturkey.sleep-notice"),object:nil,queue:.main) { note in
            guard let id=note.userInfo?["id"] as? String,let body=note.userInfo?["body"] as? String else{return}
            let content=UNMutableNotificationContent();content.title="睡眠提醒";content.body=body;content.sound = .default;content.categoryIdentifier="HotTurkey.SleepReminder"
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier:"sleep-"+id,content:content,trigger:nil))
        }
        connect()
        if !CommandLine.arguments.contains("--login") { show() }
    }
    func connection(_ completion:@escaping([String:Any]?)->Void) {
        guard let data = try? Data(contentsOf:dataDirectory.appendingPathComponent("connection.json")), let object = (try? JSONSerialization.jsonObject(with:data)) as? [String:Any], let port = object["port"] as? Int, (1...65535).contains(port), let token = object["token"] as? String,
              (object["mode"] as? String == "system") == systemMode else { completion(nil); return }
        let endpoint = systemMode ? "health" : "state"
        var request = URLRequest(url:URL(string:"http://127.0.0.1:\(port)/api/\(endpoint)")!,cachePolicy:.reloadIgnoringLocalCacheData,timeoutInterval:1)
        request.setValue("Bearer \(token)",forHTTPHeaderField:"Authorization")
        probeSession.dataTask(with:request) { _, response, error in
            let success = (response as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async {
                if !success {
                    let failure = error as NSError?
                    self.desktopLog("probe failed status \((response as? HTTPURLResponse)?.statusCode ?? 0) error \(failure?.code ?? 0)")
                }
                completion(success ? object : nil)
            }
        }.resume()
    }
    func connect() {
        if connectionPending { return }
        connectionPending = true
        connection { object in
            self.connectionPending = false
            self.connected(object)
        }
    }
    func connected(_ object:[String:Any]?) {
        if let object, let port = object["port"] as? Int, let token = object["token"] as? String {
            retries = 0
            navigationGeneration += 1
            let generation = navigationGeneration
            navigationFinished = false
            loadingLabel.stringValue = "正在加载专注空间…"
            loadingLabel.isHidden = false
            activeOrigin = URL(string:"http://127.0.0.1:\(port)")!
            activeToken = token
            currentNavigation = web.load(URLRequest(url:URL(string:"http://127.0.0.1:\(port)/#token=\(token)")!))
            desktopLog("loading")
            DispatchQueue.main.asyncAfter(deadline:.now()+4) {
                if generation == self.navigationGeneration && !self.navigationFinished { self.recoverNavigation("load deadline") }
            }
            return
        }
        if service?.isRunning == false { service = nil }
        let managed = !systemMode && FileManager.default.fileExists(atPath:FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents/local.hotturkey.service.plist").path) && Bundle.main.object(forInfoDictionaryKey:"HotTurkeyDataDirectory") == nil
        if service == nil && !managed {
            let process = Process()
            let configPath = Bundle.main.resourceURL!.appendingPathComponent("python-path.txt")
            let python = ((try? String(contentsOf:configPath,encoding:.utf8)) ?? "").trimmingCharacters(in:.whitespacesAndNewlines)
            if python.isEmpty { showError("应用运行时配置缺失，请重新安装 Broccoli。"); return }
            process.executableURL = python.hasPrefix("/") ? URL(fileURLWithPath:python) : Bundle.main.resourceURL!.appendingPathComponent(python)
            process.currentDirectoryURL = base
            process.arguments = ["-E","-s","-B","-m","hotturkey.server"] + (systemMode ? ["--system"] : ["--enforce"])
            let serviceDirectory = systemMode ? dataDirectory.deletingLastPathComponent() : dataDirectory!
            process.environment = ProcessInfo.processInfo.environment.merging(["HOTTURKEY_DATA":serviceDirectory.path,"PYTHONDONTWRITEBYTECODE":"1"]) { _,new in new }
            do { try process.run(); service = process } catch { showError("无法启动后台：\(error)"); return }
        }
        retries += 1
        if retries > 30 {
            loadingLabel.stringValue = "后台正在启动或恢复连接，正在自动重试…"
            loadingLabel.isHidden = false
            if retries == 31 { desktopLog("background pending; continuing retry") }
        }
        // A cold runtime or launchd recovery may take longer than nine seconds.
        // Keep one probe in flight and back off while the window remains usable.
        DispatchQueue.main.asyncAfter(deadline:.now()+(retries > 30 ? 2.0 : 0.3)) { self.connect() }
    }
    func desktopLog(_ message:String) {
        // Never log the navigation URL, which initially carries a local token.
        let path = dataDirectory.appendingPathComponent("desktop.log")
        let data = "\(Date().timeIntervalSince1970) \(message)\n".data(using:.utf8)!
        if let handle = try? FileHandle(forUpdating:path) {
            let size = handle.seekToEndOfFile()
            if size > 128*1024 {
                handle.seek(toFileOffset:size-min(size,64*1024))
                let tail = String(decoding:handle.readData(ofLength:64*1024),as:UTF8.self)
                let recent = tail.split(separator:"\n").suffix(600).joined(separator:"\n")+"\n"
                handle.truncateFile(atOffset:0)
                handle.write(Data(recent.utf8))
            }
            handle.seekToEndOfFile(); handle.write(data); handle.closeFile()
        } else { FileManager.default.createFile(atPath:path.path,contents:data,attributes:[.posixPermissions:0o600]) }
    }
    func recoverNavigation(_ reason:String) {
        appearance.cancelEditor()
        trackingMediaGeneration += 1
        trackingMedia.close()
        if navigationRecoveryPending { return }
        navigationGeneration += 1
        navigationRecoveries += 1
        desktopLog("recovering \(reason) attempt \(navigationRecoveries)")
        if navigationRecoveries > 3 {
            loadingLabel.stringValue = "界面连接失败，请从菜单栏重新打开 Broccoli。"
            loadingLabel.isHidden = false
            return
        }
        navigationRecoveryPending = true
        DispatchQueue.main.asyncAfter(deadline:.now()+0.5) {
            self.navigationRecoveryPending = false
            self.connect()
        }
    }
    func showError(_ text:String) { let alert = NSAlert(); alert.messageText = text; alert.beginSheetModal(for:appearance.presentationWindow ?? window) { _ in } }
    @objc func show() {
        NSApp.setActivationPolicy(.regular); window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps:true)
        if navigationRecoveries > 3 { navigationRecoveries = 0; connect() }
    }
    @objc func hide() { window.orderOut(nil) }
    @objc func quit() { NSApp.terminate(nil) }
    @objc func showSettings() { show(); appearance.showPage("settings") }
    func applicationShouldHandleReopen(_ sender:NSApplication,hasVisibleWindows:Bool)->Bool { show(); return true }
    func trustedFrame(_ frame:WKFrameInfo)->Bool {
        guard frame.isMainFrame, let origin = activeOrigin else { return false }
        return frame.securityOrigin.protocol == "http" && frame.securityOrigin.host == origin.host && frame.securityOrigin.port == origin.port
    }
    private func handleTrackingMedia(_ body:[String:Any],request:String) {
        let generation=navigationGeneration,action=body["action"] as? String ?? ""
        let complete:([String:Any])->Void = { [weak self] result in
            guard let self,self.navigationGeneration==generation,let data=try? JSONSerialization.data(withJSONObject:result.merging(["request":request]){old,_ in old}),let json=String(data:data,encoding:.utf8) else{return}
            self.trackingMedia.synchronize(appearance:self.window.appearance,textScale:self.appearance.textScale)
            self.web.evaluateJavaScript("window.HotTurkeyMediaBridge?.receive(\(json));true")
        }
        trackingMedia.command = { [weak self] op in
            guard let data=try? JSONSerialization.data(withJSONObject:[op]),let json=String(data:data,encoding:.utf8) else{return}
            self?.web.evaluateJavaScript("window.HotTurkeyTracking?.mediaAction(\(json)[0]);true")
        }
        trackingMedia.closed = { [weak self] in
            self?.trackingMediaGeneration += 1
            self?.web.evaluateJavaScript("window.HotTurkeyTracking?.mediaClosed();true")
        }
        let picture=action=="window" || action=="update" || action=="close"
        if picture { trackingMediaGeneration += 1 }
        let mediaGeneration=trackingMediaGeneration
        if action=="close" { trackingMedia.close();complete(["ok":true]);return }
        guard ["window","update","copy","open","open-with","reveal","save-as"].contains(action),let id=body["id"] as? String,
              id.range(of:#"^[a-f0-9]{32}$"#,options:.regularExpression) != nil,
              let session=body["session"] as? String,session.range(of:#"^[A-Za-z0-9_-]{0,512}$"#,options:.regularExpression) != nil,
              let origin=activeOrigin,let token=activeToken,
              let url=URL(string:"/api/tracking/screenshots/location?id=\(id)",relativeTo:origin)?.absoluteURL else {
            complete(["ok":false,"error":"图片操作无效"]);return
        }
        // The server rechecks the current settings-password session and resolves
        // the registered ID. JavaScript cannot grant access with a file path.
        var check=URLRequest(url:url,cachePolicy:.reloadIgnoringLocalCacheData,timeoutInterval:5)
        check.setValue("Bearer \(token)",forHTTPHeaderField:"Authorization");check.setValue(session,forHTTPHeaderField:"X-HotTurkey-Session")
        probeSession.dataTask(with:check) { [weak self] data,response,_ in
            let file=data.flatMap{try? JSONSerialization.jsonObject(with:$0)} as? [String:Any]
            DispatchQueue.main.async {
                guard let self,self.navigationGeneration==generation else{return}
                if picture && self.trackingMediaGeneration != mediaGeneration { complete(["ok":true,"cancelled":true]);return }
                guard (response as? HTTPURLResponse)?.statusCode==200,let relative=file?["file"] as? String else {
                    complete(["ok":false,"error":"无法读取截图，请先解锁管理界面或重新连接后台"]);return
                }
                var verified=body;verified["file"]=relative;verified["verifiedDirectory"]=file?["directory"] as? String ?? self.dataDirectory.appendingPathComponent("screenshots").path
                self.trackingMedia.handle(verified,directory:self.dataDirectory,parent:self.filePresentationWindow ?? self.window,completion:complete)
            }
        }.resume()
    }
    private func handleScreenshotDirectory(_ body:[String:Any],request:String) {
        let generation=navigationGeneration
        func complete(_ result:[String:Any]) {
            guard self.navigationGeneration==generation,let data=try? JSONSerialization.data(withJSONObject:result.merging(["request":request]){old,_ in old}),let json=String(data:data,encoding:.utf8) else{return}
            self.web.evaluateJavaScript("window.HotTurkeyMediaBridge?.receive(\(json));true")
        }
        guard let action=body["action"] as? String,["choose","open"].contains(action),let session=body["session"] as? String,
              session.range(of:#"^[A-Za-z0-9_-]{0,512}$"#,options:.regularExpression) != nil,
              let origin=activeOrigin,let token=activeToken,let url=URL(string:"/api/tracking/screenshots/directory",relativeTo:origin)?.absoluteURL else { complete(["ok":false,"error":"操作无效"]);return }
        func call(_ path:String? = nil,done:@escaping ([String:Any]?) -> Void) {
            var check=URLRequest(url:url,cachePolicy:.reloadIgnoringLocalCacheData,timeoutInterval:15)
            check.setValue("Bearer \(token)",forHTTPHeaderField:"Authorization");check.setValue(session,forHTTPHeaderField:"X-HotTurkey-Session")
            if let path { check.httpMethod="POST";check.setValue("application/json",forHTTPHeaderField:"Content-Type");check.httpBody=try? JSONSerialization.data(withJSONObject:["path":path]) }
            self.probeSession.dataTask(with:check) { data,response,_ in
                let value=(response as? HTTPURLResponse)?.statusCode==200 ? data.flatMap{try? JSONSerialization.jsonObject(with:$0)} as? [String:Any] : nil
                DispatchQueue.main.async { guard self.navigationGeneration==generation else{return};done(value) }
            }.resume()
        }
        call { value in
            guard let value,let path=value["path"] as? String else { complete(["ok":false,"error":"请先解锁管理界面或重新连接后台"]);return }
            let root=URL(fileURLWithPath:path,isDirectory:true)
            if action=="open" {
                do { try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700]);complete(["ok":NSWorkspace.shared.open(root)]) }
                catch { complete(["ok":false,"error":"无法打开截图目录"]) }
                return
            }
            guard let parent=self.filePresentationWindow ?? self.window else { complete(["ok":false,"error":"窗口不可用"]);return }
            guard parent.attachedSheet==nil else { complete(["ok":false,"error":"请先关闭当前弹窗"]);return }
            let picker=NSOpenPanel();picker.canChooseFiles=false;picker.canChooseDirectories=true;picker.allowsMultipleSelection=false;picker.canCreateDirectories=true
            picker.title="截图位置";picker.prompt="选择";picker.directoryURL=root.deletingLastPathComponent()
            picker.beginSheetModal(for:parent) { result in
                guard result == .OK,let chosen=picker.url else { complete(["ok":true,"cancelled":true]);return }
                call(chosen.path) { result in guard let result else { complete(["ok":false,"error":"无法使用所选文件夹"]);return };complete(result.merging(["ok":true]){old,_ in old}) }
            }
        }
    }
    func userContentController(_ userContentController:WKUserContentController,didReceive message:WKScriptMessage) {
        guard trustedFrame(message.frameInfo) else { return }
        if let body=message.body as? [String:Any],body["op"] as? String=="tracking-directory",let request=body["request"] as? String,request.range(of:#"^[a-zA-Z0-9_-]{1,80}$"#,options:.regularExpression) != nil { handleScreenshotDirectory(body,request:request);return }
        if let body=message.body as? [String:Any],body["op"] as? String=="tracking-copy",
           let request=body["request"] as? String,request.range(of:#"^[a-zA-Z0-9_-]{1,80}$"#,options:.regularExpression) != nil,
           let text=body["text"] as? String,text.utf8.count<=4*1024*1024 {
            NSPasteboard.general.clearContents()
            let ok=NSPasteboard.general.setString(text,forType:.string)
            if let data=try? JSONSerialization.data(withJSONObject:["request":request,"ok":ok]),let json=String(data:data,encoding:.utf8) {
                web.evaluateJavaScript("window.HotTurkeyClipboard?.receive(\(json));true")
            }
            return
        }
        if let body=message.body as? [String:Any],body["op"] as? String=="google-calendar-open",
           let text=body["url"] as? String,let url=URL(string:text),DesktopLinks.allowsGoogleCalendar(url) {
            NSWorkspace.shared.open(url);return
        }
        if let body=message.body as? [String:Any],body["op"] as? String=="notification-permission",
           let request=body["request"] as? String,request.range(of:#"^[a-zA-Z0-9_-]{1,80}$"#,options:.regularExpression) != nil,
           let mode=body["mode"] as? String,["status","request"].contains(mode) {
            let generation=navigationGeneration
            func reply() {
                UNUserNotificationCenter.current().getNotificationSettings { settings in
                    let granted=settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
                    DispatchQueue.main.async {
                        guard self.navigationGeneration==generation,
                              let data=try? JSONSerialization.data(withJSONObject:["request":request,"granted":granted]),
                              let json=String(data:data,encoding:.utf8) else{return}
                        self.web.evaluateJavaScript("window.HotTurkeyNotifications?.receive(\(json));true")
                    }
                }
            }
            if mode=="request" { UNUserNotificationCenter.current().requestAuthorization(options:[.alert,.sound]) { _,_ in reply() } }
            else { reply() }
            return
        }
        if let body=message.body as? [String:Any],body["op"] as? String=="tracking-media",let request=body["request"] as? String,
           request.range(of:#"^[a-zA-Z0-9_-]{1,80}$"#,options:.regularExpression) != nil {
            handleTrackingMedia(body,request:request)
            return
        }
        if let body = message.body as? [String:Any], body["op"] as? String == "tracking-permission", let kind = body["kind"] as? String, ["screen","accessibility"].contains(kind) {
            guard Bundle.main.object(forInfoDictionaryKey:"HotTurkeyDataDirectory") == nil, trackingPermissionProcess == nil else { return }
            let runtime = dataDirectory.appendingPathComponent("runtime/build/HotTurkeyTracker")
            let helper = FileManager.default.isExecutableFile(atPath:runtime.path) ? runtime : base.appendingPathComponent("build/HotTurkeyTracker")
            guard FileManager.default.isExecutableFile(atPath:helper.path) else { showError("统计采样组件尚未安装。"); return }
            let process = Process(); process.executableURL = helper
            process.arguments = [kind == "screen" ? "--request-screen-permission" : "--request-accessibility"]
            process.terminationHandler = { [weak self] _ in DispatchQueue.main.async { self?.trackingPermissionProcess = nil; self?.web.evaluateJavaScript("window.HotTurkeyScreenshotSettings?.refresh(); if(typeof page!=='undefined'&&page==='statistics')window.HotTurkeyTracking?.refresh(); true") } }
            do { try process.run(); trackingPermissionProcess = process } catch { showError("无法打开统计权限设置。"); }
            return
        }
        if let body = message.body as? [String:Any], body["op"] as? String == "application-icons", let targets = body["targets"] as? [String] {
            let generation = navigationGeneration
            applicationIcons.request(targets) { [weak self] icons in
                guard let self, self.navigationGeneration == generation,
                      let data = try? JSONSerialization.data(withJSONObject: icons),
                      let json = String(data: data, encoding: .utf8) else { return }
                self.web.evaluateJavaScript("window.HotTurkeyActivityIcons?.apply(\(json)); true")
            }
            return
        }
        if let body = message.body as? [String:Any], body["op"] as? String == "present-editor" {
            if trackingMedia.viewer?.isKeyWindow == true { window.makeKeyAndOrderFront(nil) }
            if nativeChromeInstalled { appearance.presentEditor() }
            else { web.evaluateJavaScript("window.HotTurkeySheet?.fallback()") }
            return
        }
        if let body = message.body as? [String:Any], body["op"] as? String == "cancel-editor" {
            appearance.cancelEditor(); return
        }
        if let body = message.body as? [String:Any], body["op"] as? String == "appearance" {
            // Older installed backends have no appearance bridge. Keep their
            // existing complete web interface until matching assets are updated.
            if !nativeChromeInstalled {
                guard let page = body["page"] as? String, FocusSidebar.pages.contains(page), body["dark"] is Bool else { return }
                appearance.install(in:window,web:web)
                nativeChromeInstalled = true
                if let frame=initialWindowFrame { window.setFrame(frame,display:true);initialWindowFrame=nil;desktopLog("initial window frame \(Int(frame.width))x\(Int(frame.height))") }
                desktopLog("native interface ready")
            }
            appearance.update(body)
            trackingMedia.synchronize(appearance:window.appearance,textScale:appearance.textScale)
            return
        }
        if let body = message.body as? [String:Any], body["op"] as? String == "install" {
            guard let data = try? Data(contentsOf:dataDirectory.appendingPathComponent("connection.json")),
                  let connection = (try? JSONSerialization.jsonObject(with:data)) as? [String:Any],
                  let port = connection["port"] as? Int,
                  message.frameInfo.securityOrigin.port == port else { return }
            if Bundle.main.object(forInfoDictionaryKey:"HotTurkeyDataDirectory") != nil {
                web.evaluateJavaScript("window.receiveInstallationResult({ok:false,message:'测试版不安装正式后台，请使用 Broccoli 正式应用。'})")
                return
            }
            installBackend(body["extensionIDs"] as? [String] ?? [])
            return
        }
        if let body = message.body as? [String:Any], body["op"] as? String == "ready", CommandLine.arguments.contains("--login") {
            if body["tray"] as? Bool == true { NSApp.setActivationPolicy(.accessory) }
            else { show() }
            return
        }
        guard let command = message.body as? String else { return }
        if command == "reconnect" { connect(); return }
        if command == "pickApp" || command == "pickFolder" || command == "pickBinary" {
            let panel = NSOpenPanel(); panel.canChooseDirectories = command == "pickFolder"; panel.canChooseFiles = command != "pickFolder"; panel.allowsMultipleSelection = true
            panel.beginSheetModal(for:appearance.presentationWindow ?? window) { response in
                if response == .OK {
                    let values = panel.urls.map { url -> String in
                        if command == "pickFolder" { return "folder:"+url.path }
                        if command == "pickBinary" { return "binary:"+url.path }
                        if let id = Bundle(url:url)?.bundleIdentifier { return "bundle:"+id }
                        return url.path
                    }
                    if let data = try? JSONSerialization.data(withJSONObject:values), let json = String(data:data,encoding:.utf8) {
                        self.web.evaluateJavaScript("window.receiveApps(\(json))")
                    }
                }
            }
        }
    }
    func installBackend(_ identifiers:[String]) {
        if systemMode {
            web.evaluateJavaScript("window.receiveInstallationResult({ok:false,message:'当前为系统保护模式，请使用系统安装方案管理后台。'})")
            return
        }
        if installation != nil { return }
        let config = Bundle.main.resourceURL!.appendingPathComponent("python-path.txt")
        let value = ((try? String(contentsOf:config,encoding:.utf8)) ?? "").trimmingCharacters(in:.whitespacesAndNewlines)
        let python = value.hasPrefix("/") ? URL(fileURLWithPath:value) : Bundle.main.resourceURL!.appendingPathComponent(value)
        let process = Process(); let output = Pipe()
        process.executableURL = python
        process.currentDirectoryURL = base
        process.arguments = ["-E","-s","-B",base.appendingPathComponent("scripts/install.py").path,"--app-source",Bundle.main.bundleURL.path]
        for identifier in identifiers { process.arguments! += ["--extension-id",identifier] }
        process.standardOutput = output; process.standardError = output
        installation = process
        do {
            try process.run()
            DispatchQueue.global(qos:.userInitiated).async {
                let data = output.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                let result:[String:Any] = ["ok":process.terminationStatus == 0,"message":String(data:data,encoding:.utf8) ?? "安装未返回结果"]
                DispatchQueue.main.async {
                    self.installation = nil
                    if let encoded = try? JSONSerialization.data(withJSONObject:result), let json = String(data:encoded,encoding:.utf8) {
                        self.web.evaluateJavaScript("window.receiveInstallationResult(\(json))")
                    }
                    if process.terminationStatus == 0 { self.connect() }
                }
            }
        } catch {
            installation = nil
            showError("无法启动安装：\(error.localizedDescription)")
            web.evaluateJavaScript("window.receiveInstallationResult({ok:false,message:'无法启动安装'})")
        }
    }
    func webView(_ webView:WKWebView,decidePolicyFor navigationAction:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void) {
        if navigationAction.request.url?.absoluteString == "about:blank" { decisionHandler(.allow); return }
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if navigationAction.shouldPerformDownload, trustedFrame(navigationAction.sourceFrame),
           url.scheme == "blob", let origin = activeOrigin,
           let resource = URL(string: String(url.absoluteString.dropFirst(5))),
           resource.scheme == origin.scheme, resource.host == origin.host, resource.port == origin.port {
            decisionHandler(.download); return
        }
        if url.scheme == "http", url.host == activeOrigin?.host, url.port == activeOrigin?.port { decisionHandler(.allow); return }
        if ["https","http"].contains(url.scheme ?? ""), url.host != "127.0.0.1" { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }
    func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!) {
        guard navigation === currentNavigation, webView.url?.host == "127.0.0.1" else { return }
        navigationFinished = true
        navigationRecoveries = 0
        loadingLabel.isHidden = true
        desktopLog("ready")
    }
    func webView(_ webView:WKWebView,didFailProvisionalNavigation navigation:WKNavigation!,withError error:Error) {
        navigationFailed(navigation,error)
    }
    func webView(_ webView:WKWebView,didFail navigation:WKNavigation!,withError error:Error) {
        navigationFailed(navigation,error)
    }
    func navigationFailed(_ navigation:WKNavigation?,_ error:Error) {
        if let navigation, let currentNavigation, navigation !== currentNavigation { return }
        let failure = error as NSError
        if failure.code == NSURLErrorCancelled { return }
        recoverNavigation("navigation error \(failure.domain) \(failure.code)")
    }
    func webViewWebContentProcessDidTerminate(_ webView:WKWebView) { recoverNavigation("web process terminated") }
    func webView(_ webView:WKWebView,runJavaScriptAlertPanelWithMessage message:String,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping()->Void) {
        guard trustedFrame(frame) else { completionHandler(); return }
        let alert = NSAlert(); alert.messageText = message; alert.addButton(withTitle:"确定")
        alert.beginSheetModal(for:appearance.presentationWindow ?? window) { _ in completionHandler() }
    }
    func webView(_ webView:WKWebView,runJavaScriptConfirmPanelWithMessage message:String,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping(Bool)->Void) {
        guard trustedFrame(frame) else { completionHandler(false); return }
        let alert = NSAlert(); alert.messageText = message; alert.alertStyle = .warning
        alert.addButton(withTitle:"确定"); alert.addButton(withTitle:"取消")
        alert.beginSheetModal(for:appearance.presentationWindow ?? window) { response in completionHandler(response == .alertFirstButtonReturn) }
    }
    func webView(_ webView:WKWebView,runJavaScriptTextInputPanelWithPrompt prompt:String,defaultText:String?,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping(String?)->Void) {
        guard trustedFrame(frame) else { completionHandler(nil); return }
        let alert = NSAlert(); alert.messageText = prompt
        let input = NSTextField(frame:NSRect(x:0,y:0,width:320,height:24)); input.stringValue = defaultText ?? ""
        alert.accessoryView = input; alert.window.initialFirstResponder = input
        alert.addButton(withTitle:"确定"); alert.addButton(withTitle:"取消")
        alert.beginSheetModal(for:appearance.presentationWindow ?? window) { response in completionHandler(response == .alertFirstButtonReturn ? input.stringValue : nil) }
    }
    func userNotificationCenter(_ center:UNUserNotificationCenter,willPresent notification:UNNotification,withCompletionHandler completionHandler:@escaping(UNNotificationPresentationOptions)->Void) { completionHandler([.banner,.sound]) }
}
#if !QA_SHEET
@main
enum DesktopApp {
static func main() {
let app = NSApplication.shared
let delegate = Delegate()
app.setActivationPolicy(.regular)
app.delegate = delegate
DesktopMenu.install(delegate: delegate)
app.run()
}
}
#endif
