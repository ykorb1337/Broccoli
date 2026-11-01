import AppKit
import WebKit
import UniformTypeIdentifiers
import Darwin

/// Only registered screenshot paths in the current user's private data folder
/// reach this bridge. It never accepts arbitrary file paths or shell commands.
final class DesktopTrackingMedia: NSObject, NSWindowDelegate {
    private(set) var viewer: NSWindow?
    private var scroll: NSScrollView?
    private var imageView: ScreenshotImageView?
    private var caption: NSTextField?
    private var toolbar: NSStackView?
    private var controls: [NSButton] = []
    private var controlHeights: [NSLayoutConstraint] = []
    private var textScale = 100
    private var imagePixels = NSSize.zero
    private var fitMode = true
    private var programmaticClose = false
    var command: ((String) -> Void)?
    var closed: (() -> Void)?
    var pasteboard = NSPasteboard.general

    func synchronize(appearance:NSAppearance?,textScale:Int) {
        viewer?.appearance=appearance
        let scale=min(200,max(50,textScale))
        if self.textScale != scale {self.textScale=scale;layoutControls()}
    }

    private func layoutControls() {
        guard let toolbar else{return}
        for row in toolbar.arrangedSubviews {toolbar.removeArrangedSubview(row);row.removeFromSuperview()}
        NSLayoutConstraint.deactivate(controlHeights);controlHeights=[]
        let size=12*max(1,CGFloat(textScale)/100),perRow=textScale>150 ? 4 : textScale>110 ? 6 : 11
        for start in stride(from:0,to:controls.count,by:perRow) {
            let row=NSStackView();row.orientation = .horizontal;row.spacing=6
            for button in controls[start..<min(start+perRow,controls.count)] {
                button.font = .systemFont(ofSize:size)
                button.setContentCompressionResistancePriority(.required,for:.horizontal)
                let height=button.heightAnchor.constraint(greaterThanOrEqualToConstant:size+14)
                controlHeights.append(height);row.addArrangedSubview(button)
            }
            toolbar.addArrangedSubview(row)
        }
        NSLayoutConstraint.activate(controlHeights)
        caption?.font = .systemFont(ofSize:size)
        viewer?.contentView?.layoutSubtreeIfNeeded()
    }

    static func imageFile(directory: URL, relative: String, id: String) throws -> (URL, NSImage) {
        func failure() -> NSError { NSError(domain:"HotTurkey.Screenshots",code:1,userInfo:[NSLocalizedDescriptionKey:"截图文件不可用，请刷新后重试。"]) }
        guard relative.range(of:#"^\d{4}-\d{2}-\d{2}/[a-f0-9]{32}\.(jpg|png|webp)$"#,options:.regularExpression) != nil,
              id.range(of:#"^[a-f0-9]{32}$"#,options:.regularExpression) != nil else { throw failure() }
        let root=directory.appendingPathComponent("screenshots",isDirectory:true),file=root.appendingPathComponent(relative)
        guard file.deletingPathExtension().lastPathComponent==id else { throw failure() }
        for url in [root,file.deletingLastPathComponent()] {
            var info=stat()
            guard lstat(url.path,&info)==0,info.st_mode & S_IFMT == S_IFDIR,info.st_uid==getuid(),info.st_mode & 0o077 == 0 else { throw failure() }
        }
        let fd=open(file.path,O_RDONLY|O_NOFOLLOW)
        guard fd>=0 else { throw failure() }
        let handle=FileHandle(fileDescriptor:fd,closeOnDealloc:true)
        defer { try? handle.close() }
        var info=stat()
        guard fstat(fd,&info)==0,info.st_mode & S_IFMT == S_IFREG,info.st_uid==getuid(),info.st_mode & 0o077==0,info.st_nlink==1,
              info.st_size>0,info.st_size<=64*1024*1024,
              let data=try handle.read(upToCount:64*1024*1024+1),data.count<=64*1024*1024 else { throw failure() }
        let headerOK=file.pathExtension=="png" ? data.starts(with:[137,80,78,71,13,10,26,10]) : file.pathExtension=="jpg" ? data.starts(with:[255,216,255]) : data.starts(with:Array("RIFF".utf8)) && data.count>=12 && data[8..<12]==Data("WEBP".utf8)
        guard headerOK,let bitmap=NSBitmapImageRep(data:data),bitmap.pixelsWide>0,bitmap.pixelsHigh>0,
              bitmap.pixelsWide<=16384,bitmap.pixelsHigh<=16384,bitmap.pixelsWide*bitmap.pixelsHigh<=64_000_000 else { throw failure() }
        let image=NSImage(size:NSSize(width:bitmap.pixelsWide,height:bitmap.pixelsHigh));image.addRepresentation(bitmap)
        return (file,image)
    }

    func handle(_ value: [String:Any], directory: URL, parent: NSWindow, completion: @escaping ([String:Any]) -> Void) {
        let action=value["action"] as? String ?? ""
        if action=="close" { close();completion(["ok":true]);return }
        guard ["window","update","copy","open","open-with"].contains(action),
              let relative=value["file"] as? String,let id=value["id"] as? String else { completion(["ok":false,"error":"图片操作无效"]);return }
        do {
            let (file,image)=try Self.imageFile(directory:directory,relative:relative,id:id)
            if action=="copy" {
                let pasteboard=self.pasteboard;pasteboard.clearContents()
                completion(["ok":pasteboard.writeObjects([image])]);return
            }
            if action=="open" { completion(["ok":NSWorkspace.shared.open(file)]);return }
            if action=="open-with" {
                guard parent.attachedSheet==nil else { completion(["ok":false,"error":"请先关闭当前弹窗"]);return }
                let picker=NSOpenPanel();picker.canChooseFiles=true;picker.canChooseDirectories=false;picker.allowsMultipleSelection=false
                picker.allowedContentTypes=[.applicationBundle];picker.directoryURL=URL(fileURLWithPath:"/Applications")
                picker.title="选择截图编辑应用";picker.prompt="打开"
                picker.beginSheetModal(for:parent) { result in
                    guard result == .OK,let app=picker.url else { completion(["ok":true,"cancelled":true]);return }
                    NSWorkspace.shared.open([file],withApplicationAt:app,configuration:NSWorkspace.OpenConfiguration()) { _,error in
                        DispatchQueue.main.async { completion(["ok":error==nil,"error":error==nil ? "" : "无法用此应用打开截图"]) }
                    }
                }
                return
            }
            if action=="update",viewer==nil { completion(["ok":true]);return }
            present(image,title:String((value["title"] as? String ?? "截图").prefix(200)),show:action=="window",frozen:value["frozen"] as? Bool == true,tagging:value["tagging"] as? Bool == true)
            completion(["ok":true])
        } catch { completion(["ok":false,"error":"截图文件不可用，请刷新后重试。"])}
    }

    private func present(_ image:NSImage,title:String,show:Bool,frozen:Bool,tagging:Bool) {
        if viewer==nil {
            let window=NSWindow(contentRect:NSRect(x:0,y:0,width:840,height:590),styleMask:[.titled,.closable,.resizable,.miniaturizable],backing:.buffered,defer:false)
            window.title="截图";window.isReleasedWhenClosed=false;window.delegate=self;window.minSize=NSSize(width:720,height:300)
            window.setAccessibilityIdentifier("HotTurkeyScreenshotViewer");window.setFrameAutosaveName("HotTurkey.ScreenshotViewer")
            let root=ScreenshotRootView(),bar=NSStackView();bar.orientation = .vertical;bar.alignment = .leading;bar.spacing=6
            let actions:[(String,String)]=[("上一张","shot-previous"),("下一张","shot-next"),("冻结","freeze"),("适配","fit"),("1:1","actual"),("−","zoom-out"),("＋","zoom-in"),("标记时间","shot-tag"),("复制","shot-copy"),("保存","shot-save"),("嵌入","shot-dock")]
            controls=actions.map {title,op in let button=NSButton(title:title,target:self,action:#selector(press(_:)));button.identifier=NSUserInterfaceItemIdentifier(op);button.setAccessibilityLabel(title);button.bezelStyle = .roundRect;return button}
            let scroll=ScreenshotScrollView();scroll.hasVerticalScroller=true;scroll.hasHorizontalScroller=true;scroll.autohidesScrollers=true
            scroll.contentView=ScreenshotClipView()
            scroll.allowsMagnification=true;scroll.minMagnification=0.02;scroll.maxMagnification=8
            scroll.userZoom = { [weak self] in self?.fitMode=false }
            scroll.command = { [weak self] op in self?.command?(op) }
            let imageView=ScreenshotImageView();imageView.imageScaling = .scaleAxesIndependently;scroll.documentView=imageView
            let caption=NSTextField(labelWithString:"");caption.font = .systemFont(ofSize:12);caption.textColor = .secondaryLabelColor;caption.lineBreakMode = .byTruncatingMiddle
            window.contentView=root
            for view in [bar,scroll,caption] { view.translatesAutoresizingMaskIntoConstraints=false;root.addSubview(view) }
            NSLayoutConstraint.activate([bar.leadingAnchor.constraint(equalTo:root.leadingAnchor,constant:10),bar.topAnchor.constraint(equalTo:root.topAnchor,constant:8),bar.trailingAnchor.constraint(lessThanOrEqualTo:root.trailingAnchor,constant:-10),scroll.leadingAnchor.constraint(equalTo:root.leadingAnchor),scroll.trailingAnchor.constraint(equalTo:root.trailingAnchor),scroll.topAnchor.constraint(equalTo:bar.bottomAnchor,constant:8),scroll.bottomAnchor.constraint(equalTo:caption.topAnchor,constant:-5),caption.leadingAnchor.constraint(equalTo:root.leadingAnchor,constant:10),caption.trailingAnchor.constraint(equalTo:root.trailingAnchor,constant:-10),caption.bottomAnchor.constraint(equalTo:root.bottomAnchor,constant:-7)])
            self.viewer=window;self.scroll=scroll;self.imageView=imageView;self.caption=caption;self.toolbar=bar
            layoutControls()
            if !window.setFrameUsingName("HotTurkey.ScreenshotViewer") { window.center() }
        }
        imagePixels=image.size;imageView?.image=image;caption?.stringValue=title;viewer?.title=title
        for button in controls {
            if button.identifier?.rawValue=="freeze" { button.title=frozen ? "继续跟随" : "冻结" }
            if button.identifier?.rawValue=="shot-tag" { button.title=tagging ? "标记到这里" : "标记时间" }
        }
        updateImageSize();if fitMode { fit() }
        if show { viewer?.makeKeyAndOrderFront(nil);viewer?.makeFirstResponder(scroll) }
    }
    private func updateImageSize() {
        let scale=viewer?.backingScaleFactor ?? 1
        imageView?.frame=NSRect(origin:.zero,size:NSSize(width:imagePixels.width/scale,height:imagePixels.height/scale))
    }
    private func fit() {
        guard let scroll,let imageView,imageView.frame.width>0,imageView.frame.height>0 else { return }
        let size=scroll.contentView.bounds.size
        scroll.magnification=min(8,max(0.02,min(size.width/imageView.frame.width,size.height/imageView.frame.height)))
    }
    @objc private func press(_ sender:NSButton) {
        guard let op=sender.identifier?.rawValue,let scroll else { return }
        if op=="fit" { fitMode=true;fit() }
        else if op=="actual" { fitMode=false;scroll.magnification=1 }
        else if op=="zoom-in" || op=="zoom-out" { fitMode=false;scroll.magnification=min(8,max(0.02,scroll.magnification*(op=="zoom-in" ? 1.25 : 0.8))) }
        else { command?(op) }
    }
    func windowDidResize(_ notification:Notification) { if fitMode { fit() } }
    func windowDidChangeBackingProperties(_ notification:Notification) { updateImageSize();if fitMode { fit() } }
    func windowWillClose(_ notification:Notification) {
        viewer=nil;scroll=nil;imageView=nil;caption=nil;toolbar=nil;controls=[];controlHeights=[]
        if !programmaticClose { closed?() }
    }
    func close() { programmaticClose=true;viewer?.close();programmaticClose=false }
}

private final class ScreenshotImageView:NSImageView {
    override func mouseDown(with event:NSEvent) {
        guard let scroll=enclosingScrollView,let window else { return }
        let start=event.locationInWindow,origin=scroll.contentView.bounds.origin
        while let next=window.nextEvent(matching:[.leftMouseDragged,.leftMouseUp]) {
            if next.type == .leftMouseUp { break }
            let point=next.locationInWindow
            scroll.contentView.scroll(to:NSPoint(x:origin.x-(point.x-start.x),y:origin.y-(point.y-start.y)))
            scroll.reflectScrolledClipView(scroll.contentView)
        }
    }
}

private final class ScreenshotRootView:NSView {
    override var isOpaque:Bool { true }
    override func draw(_ dirtyRect:NSRect) { NSColor.windowBackgroundColor.setFill();dirtyRect.fill() }
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance();needsDisplay=true }
}

private final class ScreenshotClipView:NSClipView {
    override func constrainBoundsRect(_ proposedBounds:NSRect)->NSRect {
        var result=super.constrainBoundsRect(proposedBounds)
        if let size=documentView?.frame.size {
            if size.width<result.width { result.origin.x=(size.width-result.width)/2 }
            if size.height<result.height { result.origin.y=(size.height-result.height)/2 }
        }
        return result
    }
}

private final class ScreenshotScrollView:NSScrollView {
    var userZoom:(()->Void)?
    var command:((String)->Void)?
    override var acceptsFirstResponder:Bool { true }
    override func magnify(with event:NSEvent) { userZoom?();super.magnify(with:event) }
    override func scrollWheel(with event:NSEvent) {
        if event.modifierFlags.contains(.control) { if abs(event.scrollingDeltaY)>0.5 { command?(event.scrollingDeltaY>0 ? "shot-previous" : "shot-next") };return }
        userZoom?();magnification=min(maxMagnification,max(minMagnification,magnification*exp(-event.scrollingDeltaY*0.02)))
    }
    override func keyDown(with event:NSEvent) {
        if [123,124].contains(event.keyCode) {
            let direction=event.keyCode==123 ? "previous" : "next"
            command?((event.modifierFlags.contains(.shift) ? "shot-select-" : event.modifierFlags.contains(.control) ? "shot-add-" : "shot-")+direction);return
        }
        if event.keyCode==103 { command?("freeze");return }
        if event.keyCode==111 { command?("viewer");return }
        super.keyDown(with:event)
    }
}
