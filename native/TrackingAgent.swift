import AppKit
import ApplicationServices
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
import ScreenCaptureKit

/// An observation-only helper, separate from the blocking executor.
final class LocalTracker {
    private let lock = NSLock()
    private var configuration: [String: Any] = [:]
    private var completed: [[String: Any]] = []
    private var sleeping = false
    private var capturing = false
    private var captureError = ""
    private var captureGeneration = 0
    let directory: URL
    init(directory: URL) { self.directory = directory }
    func configure(_ value: [String: Any]) {
        lock.lock()
        if value["record"] as? Bool == false { captureGeneration += 1 }
        configuration = value
        lock.unlock()
        for notice in (value["notifications"] as? [String] ?? []).prefix(8) {
            DistributedNotificationCenter.default().postNotificationName(NSNotification.Name("local.hotturkey.notice"),object:String(notice.prefix(300)),userInfo:nil,deliverImmediately:true)
        }
    }
    func config() -> [String: Any] { lock.lock(); defer { lock.unlock() }; return configuration }
    func generation() -> Int { lock.lock(); defer { lock.unlock() }; return captureGeneration }
    func append(_ metadata: [String: Any]) { lock.lock(); completed.append(metadata); lock.unlock() }
    func readAX(_ element: AXUIElement, _ attribute: CFString) -> AnyObject? {
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, attribute, &value) == .success ? value : nil
    }
    func foreground() -> [String: String] {
        guard let app = NSWorkspace.shared.frontmostApplication else { return [:] }
        var value = ["application":app.localizedName ?? "", "bundle":app.bundleIdentifier ?? "", "path":app.bundleURL?.path ?? app.executableURL?.path ?? "", "title":"", "document":""]
        if config()["record"] as? Bool == true && config()["titles"] as? Bool != false && AXIsProcessTrusted() {
            let application = AXUIElementCreateApplication(app.processIdentifier)
            AXUIElementSetMessagingTimeout(application,0.2)
            if let window = readAX(application, kAXFocusedWindowAttribute as CFString), CFGetTypeID(window) == AXUIElementGetTypeID() {
                let element = unsafeBitCast(window, to: AXUIElement.self)
                value["title"] = (readAX(element, kAXTitleAttribute as CFString) as? String ?? "").prefix(4096).description
                value["document"] = (readAX(element, kAXDocumentAttribute as CFString) as? String ?? "").prefix(4096).description
            }
        }
        return value
    }
    func sample() {
        let state = config()
        let front = foreground()
        let session = CGSessionCopyCurrentDictionary() as? [String: Any] ?? [:]
        let formats = CGImageDestinationCopyTypeIdentifiers() as? [String] ?? []
        var result: [String: Any] = ["apps":[], "front":front, "at":Date().timeIntervalSince1970, "capture_error":captureError, "idle":CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType:CGEventType(rawValue:UInt32.max)!),
            "locked":session["CGSSessionScreenIsLocked"] as? Bool ?? false, "sleeping":sleeping,
            "permissions":["accessibility":AXIsProcessTrusted(),"screen_recording":CGPreflightScreenCaptureAccess(),"formats":["jpeg","png"] + (formats.contains(UTType.webP.identifier) ? ["webp"] : [])]]
        lock.lock(); result["screenshots"] = completed; completed.removeAll(); lock.unlock()
        if let data = try? JSONSerialization.data(withJSONObject:result) { FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10])) }
        if state["capture"] as? Bool == true && state["record"] as? Bool == true && !sleeping && result["locked"] as? Bool != true && CGPreflightScreenCaptureAccess() && !capturing {
            capturing = true
            captureError = ""
            let generation = self.generation()
            Task { @MainActor in
                do {
                    let frames = try await self.frames(state)
                    for (display,image) in frames {
                        let current = self.generation()
                        if generation != current || self.foreground() != front { break }
                        if let metadata = try self.save(image, display:display, front:front, settings:state) {
                            self.append(metadata)
                        }
                    }
                } catch { self.captureError = "无法截取屏幕：" + String(error.localizedDescription.prefix(300)) }
                self.capturing = false
            }
        }
    }
    @MainActor func frames(_ config: [String: Any]) async throws -> [(String, CGImage)] {
        let maxWidth = min(7680,max(320,config["max_width"] as? Int ?? 2560))
        let mainOnly = config["displays"] as? String == "main"
        if #available(macOS 14.0, *) {
            let content = try await SCShareableContent.excludingDesktopWindows(false,onScreenWindowsOnly:true)
            var frames: [(String, CGImage)] = []
            for display in content.displays.prefix(12) where !mainOnly || display.displayID == CGMainDisplayID() {
                let stream = SCStreamConfiguration()
                stream.width = min(maxWidth,display.width); stream.height = max(1,display.height * stream.width / max(1,display.width)); stream.showsCursor = true
                let image = try await SCScreenshotManager.captureImage(contentFilter:SCContentFilter(display:display,excludingWindows:[]),configuration:stream)
                frames.append((String(display.displayID),image))
            }
            return frames
        } else {
            var displays = [CGDirectDisplayID](repeating:0,count:12),count:UInt32 = 0
            guard CGGetActiveDisplayList(12,&displays,&count) == .success else { return [] }
            return displays.prefix(Int(count)).compactMap { display in
                guard !mainOnly || display == CGMainDisplayID(), let image = CGDisplayCreateImage(display) else { return nil }
                return (String(display),image)
            }
        }
    }
    func save(_ source: CGImage, display: String, front: [String:String], settings: [String:Any]) throws -> [String:Any]? {
        let format = settings["format"] as? String ?? "jpeg"
        let type = format == "png" ? UTType.png : format == "webp" ? UTType.webP : UTType.jpeg
        guard (CGImageDestinationCopyTypeIdentifiers() as? [String] ?? []).contains(type.identifier) else { captureError = "当前系统不支持此截图格式";return nil }
        let maxWidth = min(7680,max(320,settings["max_width"] as? Int ?? 2560))
        var image = source
        if source.width > maxWidth, let context = CGContext(data:nil,width:maxWidth,height:max(1,source.height*maxWidth/source.width),bitsPerComponent:8,bytesPerRow:0,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue) {
            context.interpolationQuality = .high; context.draw(source,in:CGRect(x:0,y:0,width:context.width,height:context.height))
            if let scaled = context.makeImage() { image = scaled }
        }
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data,type.identifier as CFString,1,nil) else { return nil }
        CGImageDestinationAddImage(destination,image,[kCGImageDestinationLossyCompressionQuality:0.8] as CFDictionary)
        guard CGImageDestinationFinalize(destination),data.length <= 64*1024*1024 else { return nil }
        let formatter = DateFormatter(); formatter.dateFormat = "yyyy-MM-dd"; formatter.locale = Locale(identifier:"en_US_POSIX")
        let date = formatter.string(from:Date()),ident = UUID().uuidString.replacingOccurrences(of:"-",with:"").lowercased()
        let folder = directory.appendingPathComponent(date,isDirectory:true)
        try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        try FileManager.default.setAttributes([.posixPermissions:0o700],ofItemAtPath:directory.path)
        let relative = date + "/" + ident + (format == "jpeg" ? ".jpg" : "." + format),file = directory.appendingPathComponent(relative)
        try (data as Data).write(to:file,options:.atomic);try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:file.path)
        return ["id":ident,"capture_id":settings["capture_id"] as? String ?? "","file":relative,"display":display,"width":image.width,"height":image.height,"application":front["application"] ?? "","bundle":front["bundle"] ?? "","title":front["title"] ?? "","at":Date().timeIntervalSince1970]
    }
    func observePower() {
        let center = NSWorkspace.shared.notificationCenter
        center.addObserver(forName:NSWorkspace.willSleepNotification,object:nil,queue:.main) { [weak self] _ in self?.sleeping = true; self?.sample() }
        center.addObserver(forName:NSWorkspace.didWakeNotification,object:nil,queue:.main) { [weak self] _ in self?.sleeping = false; self?.sample() }
        center.addObserver(forName:NSWorkspace.sessionDidResignActiveNotification,object:nil,queue:.main) { [weak self] _ in self?.sample() }
    }
}
@main enum TrackingMain {
    static func main() {
        let app = NSApplication.shared; app.setActivationPolicy(.accessory)
        if CommandLine.arguments.contains("--request-screen-permission") { _ = CGRequestScreenCaptureAccess(); return }
        if CommandLine.arguments.contains("--request-accessibility") { _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String:true] as CFDictionary); return }
        guard CommandLine.arguments.count == 2 else { return }
        let tracker = LocalTracker(directory:URL(fileURLWithPath:CommandLine.arguments[1],isDirectory:true));tracker.observePower()
        DispatchQueue.global(qos:.utility).async {
            while let line = readLine(),line.utf8.count <= 65536 {
                guard let data = line.data(using:.utf8),let value = (try? JSONSerialization.jsonObject(with:data)) as? [String:Any] else { break }
                tracker.configure(value)
            }
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
        let timer = Timer.scheduledTimer(withTimeInterval:1,repeats:true) { _ in tracker.sample() }
        withExtendedLifetime((tracker,timer)) { app.run() }
    }
}
