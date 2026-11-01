import AppKit
import WebKit

private final class EditorRenderCover: NSView {
    override var isOpaque: Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        NSColor.windowBackgroundColor.setFill()
        dirtyRect.fill()
    }
}

private final class DesktopEditorPanel: NSPanel {
    var closeEditor: (() -> Void)?
    // Sheets hide the traffic lights; NSWindow's default performClose can then
    // ignore the standard Close command. Route it through the existing editor.
    override func performClose(_ sender: Any?) { closeEditor?() }
    override func cancelOperation(_ sender: Any?) { closeEditor?() }
}

/// Reparents the existing editor, retaining its DOM, draft and authentication.
/// AppKit owns sheet placement, modality and nested file/confirmation panels.
final class DesktopSheet: NSObject, NSWindowDelegate {
    weak var parent: NSWindow?
    weak var web: WKWebView?
    weak var host: NSView?
    private(set) var panel: NSPanel?
    private var placeholder: NSImageView?
    private var renderCover: NSView?
    private var generation = 0
    private var preparing = false
    private var presented = false
    private var editorRendered = false
    var onFailure: (() -> Void)?
    var onPresentation: ((Bool) -> Void)?

    init(parent: NSWindow, web: WKWebView, host: NSView) {
        self.parent = parent; self.web = web; self.host = host
    }

    func present() {
        guard panel == nil, !preparing, let web else { return }
        generation += 1; let current = generation; preparing = true
        // The HTML dialog is still closed, so the snapshot contains no editor
        // or typed credential. It remains in memory only while the sheet is up.
        web.takeSnapshot(with: nil) { [weak self] image, error in
            guard let self, self.generation == current, self.preparing else { return }
            guard error == nil, image != nil else { self.reset(); self.onFailure?(); return }
            self.attach(image: image)
        }
        // Includes a stalled snapshot, not just a stalled editor handshake.
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            guard let self, self.generation == current, !self.editorRendered else { return }
            self.reset(); self.onFailure?()
        }
    }

    private func attach(image: NSImage?) {
        guard let parent, parent.isVisible, let host, let web else { reset(); onFailure?(); return }
        let cover = NSImageView(frame: host.bounds)
        cover.image = image; cover.imageScaling = .scaleAxesIndependently
        cover.autoresizingMask = [.width, .height]
        host.addSubview(cover); placeholder = cover
        let size = constrained(width: 720, height: 500)
        let panel = DesktopEditorPanel(contentRect: NSRect(origin: .zero, size: size),
                            styleMask: [.titled, .closable, .fullSizeContentView], backing: .buffered, defer: false)
        panel.titleVisibility = .hidden; panel.titlebarAppearsTransparent = true
        panel.standardWindowButton(.closeButton)?.isHidden = true
        panel.isReleasedWhenClosed = false; panel.delegate = self
        panel.closeEditor = { [weak self] in self?.requestClose() }
        panel.appearance = parent.appearance
        panel.setAccessibilityIdentifier("HotTurkeyEditorSheet")
        let content = NSView(frame: NSRect(origin: .zero, size: size))
        panel.contentView = content; self.panel = panel
        web.removeFromSuperview(); web.frame = content.bounds
        web.autoresizingMask = [.width, .height]; content.addSubview(web)
        // WebKit may still display the main page's backing layer immediately
        // after reparenting. Do not expose it during the sheet animation.
        let editorCover = EditorRenderCover(frame: content.bounds)
        editorCover.autoresizingMask = [.width, .height]
        editorCover.setAccessibilityElement(false)
        editorCover.setAccessibilityIdentifier("HotTurkeyEditorRenderCover")
        content.addSubview(editorCover); renderCover = editorCover
        let current = generation
        web.evaluateJavaScript("window.HotTurkeySheet?.show()") { [weak self] _, error in
            guard let self, self.generation == current, self.panel != nil else { return }
            if error != nil { self.reset(); self.onFailure?() }
        }
    }

    func synchronize(_ value: [String: Any]) {
        guard let panel else { return }
        guard value["modal"] as? Bool == true else {
            if !preparing { reset() }
            return
        }
        guard let width = value["modalWidth"] as? Double, let height = value["modalHeight"] as? Double,
              width.isFinite, height.isFinite, (100...16000).contains(width), (100...16000).contains(height) else { return }
        let size = constrained(width: width, height: height)
        let old = panel.contentView?.bounds.size ?? .zero
        if abs(old.width - size.width) > 1 || abs(old.height - size.height) > 1 {
            panel.setContentSize(size)
        }
        panel.appearance = parent?.appearance
        panel.title = String((value["modalTitle"] as? String ?? "编辑").prefix(160))
        if !presented, let parent {
            preparing = false; presented = true
            parent.beginSheet(panel)
            panel.makeFirstResponder(web)
            onPresentation?(true)
            finishInitialRendering()
        }
    }

    private func finishInitialRendering() {
        guard let web, let panel else { return }
        let current = generation
        web.callAsyncJavaScript("""
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return document.documentElement.classList.contains('native-sheet') &&
                document.querySelector('#modal')?.open === true &&
                getComputedStyle(document.querySelector('main')).display === 'none';
            """, arguments: [:], in: nil, in: .page) { [weak self] result in
            guard let self, self.generation == current, self.panel === panel, self.presented else { return }
            guard case .success(let ready) = result, ready as? Bool == true else {
                self.reset(); self.onFailure?(); return
            }
            let configuration = WKSnapshotConfiguration()
            configuration.afterScreenUpdates = true
            web.takeSnapshot(with: configuration) { [weak self] image, error in
                guard let self, self.generation == current, self.panel === panel, self.presented else { return }
                guard image != nil, error == nil else { self.reset(); self.onFailure?(); return }
                self.editorRendered = true
                self.renderCover?.removeFromSuperview(); self.renderCover = nil
            }
        }
    }

    private func constrained(width: Double, height: Double) -> NSSize {
        let frame = parent?.frame.size ?? NSSize(width: 920, height: 650)
        return NSSize(width: min(max(300, width), max(300, frame.width - 48)),
                      height: min(max(160, height), max(160, frame.height - 90)))
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        requestClose(); return false
    }

    func requestClose() {
        web?.evaluateJavaScript("window.HotTurkeySheet?.cancel()") { [weak self] _, error in
            if error != nil { self?.reset(); self?.onFailure?() }
        }
    }

    func reset() {
        generation += 1; preparing = false; editorRendered = false
        renderCover?.removeFromSuperview(); renderCover = nil
        guard let panel else { return }
        if let child = panel.attachedSheet { panel.endSheet(child, returnCode: .cancel) }
        if presented { parent?.endSheet(panel); onPresentation?(false) }
        presented = false
        if let web, let host {
            web.removeFromSuperview(); web.frame = host.bounds
            web.autoresizingMask = [.width, .height]; host.addSubview(web)
            parent?.makeFirstResponder(web)
        }
        panel.orderOut(nil); self.panel = nil
        placeholder?.removeFromSuperview(); placeholder = nil
        web?.evaluateJavaScript("document.documentElement.classList.remove('native-sheet'); window.HotTurkeyModal?.restore(); true")
    }
}
