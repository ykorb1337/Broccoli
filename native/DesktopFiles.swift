import AppKit
import WebKit
import UniformTypeIdentifiers
import Darwin

/// File access always goes through an AppKit panel. Exports download to a
/// temporary sibling so a failed transfer never truncates an existing file.
final class DesktopFiles: NSObject, WKDownloadDelegate {
    struct Export {
        let download: WKDownload
        var destination: URL?
        var temporary: URL?
    }
    let parent: () -> NSWindow?
    let event: (String) -> Void
    private var exports: [ObjectIdentifier: Export] = [:]
    var initialDirectory: URL?
    init(parent: @escaping () -> NSWindow?, event: @escaping (String) -> Void = { _ in }) {
        self.parent = parent; self.event = event
    }

    func open(_ parameters: WKOpenPanelParameters, completion: @escaping ([URL]?) -> Void) {
        guard let window = parent(), window.isVisible, window.attachedSheet == nil else { completion(nil); return }
        event("import panel opening")
        let panel = NSOpenPanel()
        panel.canChooseFiles = true; panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        if let initialDirectory { panel.directoryURL = initialDirectory }
        panel.beginSheetModal(for: window) { result in
            self.event(result == .OK ? "import selected" : "import cancelled")
            completion(result == .OK ? panel.urls : nil)
        }
        event("import panel ready")
    }

    func receive(_ download: WKDownload) {
        event("export requested")
        exports[ObjectIdentifier(download)] = Export(download: download)
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let key = ObjectIdentifier(download)
        guard exports[key] != nil, let window = parent(), window.isVisible, window.attachedSheet == nil else {
            exports.removeValue(forKey: key); completionHandler(nil); return
        }
        event("export panel opening")
        let panel = NSSavePanel()
        let clean = suggestedFilename.components(separatedBy: .controlCharacters).joined()
        let name = String(URL(fileURLWithPath: clean).lastPathComponent.prefix(160))
        panel.nameFieldStringValue = name.isEmpty ? "HotTurkey.json" : name
        let ext = (panel.nameFieldStringValue as NSString).pathExtension
        panel.allowedContentTypes = [UTType(filenameExtension: ext) ?? .data]
        panel.allowsOtherFileTypes = false; panel.canCreateDirectories = true
        if let initialDirectory { panel.directoryURL = initialDirectory }
        panel.prompt = "导出"
        panel.beginSheetModal(for: window) { [weak self] result in
            self?.event(result == .OK ? "export selected" : "export cancelled")
            guard let self, result == .OK, let destination = panel.url else {
                self?.exports.removeValue(forKey: key); completionHandler(nil); return
            }
            let temporary = destination.deletingLastPathComponent().appendingPathComponent(".hotturkey-export-\(UUID().uuidString).part")
            self.exports[key]?.destination = destination; self.exports[key]?.temporary = temporary
            completionHandler(temporary)
        }
        event("export panel ready")
    }

    static func commit(temporary: URL, destination: URL) throws {
        let files = FileManager.default
        let existing = try? files.attributesOfItem(atPath: destination.path)
        let permissions = existing?[.type] as? FileAttributeType == .typeRegular ? existing?[.posixPermissions] ?? NSNumber(value: 0o600) : NSNumber(value: 0o600)
        try files.setAttributes([.posixPermissions: permissions], ofItemAtPath: temporary.path)
        guard rename(temporary.path, destination.path) == 0 else {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
        }
    }

    func cancelAll() {
        let pending = Array(exports.values); exports.removeAll()
        for item in pending {
            if let temporary = item.temporary { try? FileManager.default.removeItem(at: temporary) }
            item.download.cancel { _ in
                if let temporary = item.temporary { try? FileManager.default.removeItem(at: temporary) }
            }
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        event("export finished")
        guard let item = exports.removeValue(forKey: ObjectIdentifier(download)),
              let temporary = item.temporary, let destination = item.destination else { return }
        do { try Self.commit(temporary: temporary, destination: destination) }
        catch { try? FileManager.default.removeItem(at: temporary); showFailure() }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        guard let item = exports.removeValue(forKey: ObjectIdentifier(download)) else { return }
        if let temporary = item.temporary { try? FileManager.default.removeItem(at: temporary) }
        if (error as NSError).code != NSURLErrorCancelled { showFailure() }
    }

    func download(_ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, decisionHandler: @escaping (WKDownload.RedirectPolicy) -> Void) {
        decisionHandler(.cancel)
    }

    private func showFailure() {
        guard let window = parent(), window.isVisible else { return }
        let alert = NSAlert(); alert.messageText = "无法导出文件"
        alert.informativeText = "请检查保存位置是否可写，然后重试。"
        alert.beginSheetModal(for: window) { _ in }
    }
}

extension Delegate {
    func applicationWillTerminate(_ notification: Notification) { fileDialogs?.cancelAll() }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        guard trustedFrame(frame) else { completionHandler(nil); return }
        fileDialogs.open(parameters, completion: completionHandler)
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        fileDialogs.receive(download)
    }
}
