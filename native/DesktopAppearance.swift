import AppKit
import WebKit

// The operating system owns the sidebar material, toolbar glass, selection,
// accessibility and window controls. The policy interface stays in WebKit.
final class DesktopAppearance: NSObject, NSToolbarDelegate, NSMenuItemValidation {
    let split = NSSplitViewController()
    let sidebar = FocusSidebar()
    weak var web: WKWebView?
    weak var window: NSWindow?
    private var actions: [String: NSToolbarItem] = [:]
    private var modalActive = false
    private(set) var currentPage = "overview"
    private(set) var canManage = false
    private(set) var textScale = 100
    var canNavigate: Bool { window != nil && !modalActive && window?.attachedSheet == nil }
    var canCreate: Bool { canNavigate && canManage }
    private let identifiers = ["new", "export-stats"]
    private var creationActions = Set<String>()
    private var creationMenu: NSMenu?
    private var editorSheet: DesktopSheet?
    private var style: DesktopStyle?
    var presentationWindow: NSWindow? { editorSheet?.panel ?? window }
    var sheetChanged: ((Bool) -> Void)?

    func install(in window: NSWindow, web: WKWebView) {
        self.window = window; self.web = web
        let content = NSViewController(); let host = AppearanceHost(); content.view = host
        web.removeFromSuperview(); web.frame = host.bounds
        web.autoresizingMask = [.width, .height]; host.addSubview(web)
        let navigation = NSSplitViewItem(sidebarWithViewController: sidebar)
        navigation.minimumThickness = 200; navigation.maximumThickness = 280
        navigation.preferredThicknessFraction = 0.2
        split.addSplitViewItem(navigation)
        split.addSplitViewItem(NSSplitViewItem(viewController: content))
        window.contentViewController = split
        style = DesktopStyle(window: window, web: web)
        host.appearanceChanged = { [weak self] in self?.style?.refresh() }
        split.view.layoutSubtreeIfNeeded(); web.frame = host.bounds
        editorSheet = DesktopSheet(parent: window, web: web, host: host)
        editorSheet?.onPresentation = { [weak self] shown in self?.sheetChanged?(shown) }
        editorSheet?.onFailure = { [weak self] in
            self?.web?.evaluateJavaScript("window.HotTurkeySheet?.fallback()")
        }
        window.titlebarAppearsTransparent = true
        window.toolbarStyle = .unified
        let toolbar = NSToolbar(identifier: "HotTurkey.Navigation")
        toolbar.delegate = self; toolbar.displayMode = .iconOnly
        toolbar.allowsUserCustomization = false
        window.toolbar = toolbar
        sidebar.navigate = { [weak self] page in self?.click("[data-page=\(page)]") }
        sidebar.performAction = { [weak self] action in
            guard let self, !self.modalActive || action == "device-emergency" else { return }
            self.click("[data-action=\(action)]")
        }
    }

    private func click(_ selector: String) {
        // Selectors only come from the fixed page/action lists in this file.
        web?.evaluateJavaScript("document.querySelector('\(selector)')?.click()") { _, error in
            if let error { NSLog("HotTurkey interface action failed: %@", error.localizedDescription) }
        }
    }

    func showPage(_ page: String) {
        guard FocusSidebar.pages.contains(page), !modalActive else { return }
        click("[data-page=\(page)]")
    }

    func create(_ action: String) {
        guard canCreate, ["new", "new-device"].contains(action) else { return }
        web?.evaluateJavaScript("document.querySelector('nav [data-page=blocks]')?.click(); document.querySelector('#header-actions [data-action=\(action)]')?.click()")
    }

    func adjustTextSize(_ action: String) {
        guard ["increase", "decrease", "reset"].contains(action) else { return }
        web?.evaluateJavaScript("window.HotTurkeyTextSize?.\(action)(); true")
    }

    func update(_ value: [String: Any]) {
        guard let page = value["page"] as? String, FocusSidebar.pages.contains(page),
              let dark = value["dark"] as? Bool else { return }
        let titles = ["overview":"概览", "blocks":"拦截规则", "schedule":"每周日程", "statistics":"使用统计", "settings":"设置"]
        window?.title = titles[page] ?? "HotTurkey"
        currentPage = page
        canManage = value["canManage"] as? Bool == true
        if let scale = value["textScale"] as? Int, (50...200).contains(scale) { textScale = scale }
        window?.appearance = value["theme"] as? String == "system" ? nil : NSAppearance(named: dark ? .darkAqua : .aqua)
        sidebar.select(page)
        if let status = value["connection"] as? String {
            sidebar.connection.stringValue = String(status.prefix(100))
            sidebar.connection.textColor = value["connected"] as? Bool == true ? .secondaryLabelColor : .systemOrange
        }
        let modal = value["modal"] as? Bool == true
        modalActive = modal
        sidebar.table.isEnabled = !modal
        let available = value["actions"] as? [String] ?? []
        creationActions = Set(available.filter { ["new", "new-device"].contains($0) })
        for item in creationMenu?.items ?? [] {
            item.isEnabled = !modal && canManage && creationActions.contains(item.representedObject as? String ?? "")
        }
        for (name, item) in actions {
            let visible = name == "new" ? !creationActions.isEmpty : available.contains(name)
            item.isEnabled = !modal && visible
            if #available(macOS 15.0, *) { item.isHidden = !visible }
        }
        editorSheet?.synchronize(value)
        style?.refresh(force: value["paletteReady"] as? Bool != true)
    }

    func presentEditor() { editorSheet?.present() }
    func cancelEditor() { editorSheet?.reset() }

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [.toggleSidebar, .sidebarTrackingSeparator, .flexibleSpace] + identifiers.map { .init($0) }
    }
    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        toolbarDefaultItemIdentifiers(toolbar)
    }
    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier identifier: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        if identifier == .sidebarTrackingSeparator {
            return NSTrackingSeparatorToolbarItem(identifier: identifier, splitView: split.splitView, dividerIndex: 0)
        }
        if identifier == .toggleSidebar {
            let item = NSToolbarItem(itemIdentifier: identifier)
            item.label = "显示或隐藏侧栏"; item.toolTip = item.label
            item.image = NSImage(systemSymbolName: "sidebar.left", accessibilityDescription: item.label)
            item.target = split; item.action = #selector(NSSplitViewController.toggleSidebar(_:)); item.isBordered = true
            return item
        }
        guard identifiers.contains(identifier.rawValue) else { return nil }
        if identifier.rawValue == "new" {
            let item = NSMenuToolbarItem(itemIdentifier: identifier)
            item.label = "新建"; item.toolTip = "新建拦截规则或睡眠计划"
            item.image = NSImage(systemSymbolName: "plus", accessibilityDescription: item.label)
            let menu = NSMenu(title: "新建")
            for (title, action, symbol, selector) in [
                ("新建拦截规则", "new", "shield.lefthalf.filled", #selector(newRule(_:))),
                ("新建睡眠计划", "new-device", "bed.double", #selector(newDevice(_:)))
            ] {
                let entry = menu.addItem(withTitle: title, action: selector, keyEquivalent: "")
                entry.target = self; entry.representedObject = action; entry.isEnabled = false
                entry.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
            }
            creationMenu = menu; item.menu = menu; item.showsIndicator = true
            item.isBordered = true; item.isEnabled = false; item.autovalidates = false
            actions["new"] = item
            return item
        }
        let labels = ["export-stats":"导出统计"]
        let symbols = ["export-stats":"square.and.arrow.up"]
        let item = NSToolbarItem(itemIdentifier: identifier)
        item.label = labels[identifier.rawValue]!; item.toolTip = item.label
        item.image = NSImage(systemSymbolName: symbols[identifier.rawValue]!, accessibilityDescription: item.label)
        item.target = self
        item.action = #selector(exportStatistics(_:))
        item.isBordered = true; item.isEnabled = false; item.autovalidates = false
        actions[identifier.rawValue] = item
        return item
    }
    private func invoke(_ action: String) {
        if ["new", "new-device"].contains(action) {
            guard canCreate, creationActions.contains(action) else { return }
        } else if actions[action]?.isEnabled != true { return }
        click("#header-actions [data-action=\(action)]")
    }
    @objc private func newRule(_ sender: Any?) { invoke("new") }
    @objc private func newDevice(_ sender: Any?) { invoke("new-device") }
    @objc private func exportStatistics(_ sender: Any?) { invoke("export-stats") }
    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        guard let action = menuItem.representedObject as? String else { return false }
        return canCreate && creationActions.contains(action)
    }
}

final class FocusSidebar: NSViewController, NSTableViewDataSource, NSTableViewDelegate {
    static let pages = ["overview", "blocks", "schedule", "statistics", "settings"]
    private let titles = ["概览", "拦截规则", "每周日程", "使用统计", "设置"]
    private let symbols = ["square.grid.2x2", "shield.lefthalf.filled", "calendar", "chart.bar.xaxis", "gearshape"]
    let table = NSTableView()
    let connection = NSTextField(labelWithString: "正在连接后台…")
    var navigate: ((String) -> Void)?
    var performAction: ((String) -> Void)?

    override func loadView() {
        view = NSView()
        let column = NSTableColumn(identifier: .init("Navigation")); table.addTableColumn(column)
        table.headerView = nil; table.backgroundColor = .clear; table.style = .sourceList
        table.rowHeight = 36; table.intercellSpacing = NSSize(width: 0, height: 2)
        table.dataSource = self; table.delegate = self
        table.setAccessibilityLabel("主要导航")
        let scroll = NSScrollView(); scroll.documentView = table; scroll.drawsBackground = false
        scroll.hasVerticalScroller = true; scroll.autohidesScrollers = true
        let icon = NSImageView(image: NSApp.applicationIconImage)
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.widthAnchor.constraint(equalToConstant: 30).isActive = true
        icon.heightAnchor.constraint(equalToConstant: 30).isActive = true
        let name = NSTextField(labelWithString: "HotTurkey"); name.font = .systemFont(ofSize: 16, weight: .semibold)
        let brand = NSStackView(views: [icon, name]); brand.spacing = 9
        connection.font = .systemFont(ofSize: 11); connection.textColor = .secondaryLabelColor
        connection.lineBreakMode = .byTruncatingTail
        let emergency = NSButton(title: "紧急放行设备限制", target: self, action: #selector(emergencyAction))
        emergency.bezelStyle = .inline; emergency.font = .systemFont(ofSize: 11)
        emergency.contentTintColor = .secondaryLabelColor
        let setup = NSButton(title: "浏览器与安装说明", target: self, action: #selector(setupAction))
        setup.bezelStyle = .inline; setup.font = .systemFont(ofSize: 11); setup.contentTintColor = .secondaryLabelColor
        let bottom = NSStackView(views: [connection, emergency, setup])
        bottom.orientation = .vertical; bottom.alignment = .leading; bottom.spacing = 10
        for child in [brand, scroll, bottom] { child.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(child) }
        NSLayoutConstraint.activate([
            brand.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 18),
            brand.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 18),
            brand.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -16),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 8),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -8),
            scroll.topAnchor.constraint(equalTo: brand.bottomAnchor, constant: 23),
            scroll.bottomAnchor.constraint(equalTo: bottom.topAnchor, constant: -20),
            bottom.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 18),
            bottom.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -16),
            bottom.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -20)
        ])
        table.selectRowIndexes(IndexSet(integer: 0), byExtendingSelection: false)
    }
    func numberOfRows(in tableView: NSTableView) -> Int { Self.pages.count }
    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let cell = NSTableCellView(); let image = NSImageView(); let label = NSTextField(labelWithString: titles[row])
        image.image = NSImage(systemSymbolName: symbols[row], accessibilityDescription: nil)
        image.contentTintColor = .controlAccentColor
        label.font = .systemFont(ofSize: 13); cell.imageView = image; cell.textField = label
        for child in [image, label] { child.translatesAutoresizingMaskIntoConstraints = false; cell.addSubview(child) }
        NSLayoutConstraint.activate([
            image.leadingAnchor.constraint(equalTo: cell.leadingAnchor, constant: 10), image.centerYAnchor.constraint(equalTo: cell.centerYAnchor),
            image.widthAnchor.constraint(equalToConstant: 18), image.heightAnchor.constraint(equalToConstant: 18),
            label.leadingAnchor.constraint(equalTo: image.trailingAnchor, constant: 10), label.centerYAnchor.constraint(equalTo: cell.centerYAnchor),
            label.trailingAnchor.constraint(lessThanOrEqualTo: cell.trailingAnchor, constant: -8)
        ])
        return cell
    }
    func tableViewSelectionDidChange(_ notification: Notification) {
        let row = table.selectedRow; if Self.pages.indices.contains(row) { navigate?(Self.pages[row]) }
    }
    func select(_ page: String) {
        if let row = Self.pages.firstIndex(of: page), table.selectedRow != row { table.selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false) }
    }
    @objc private func emergencyAction() { performAction?("device-emergency") }
    @objc private func setupAction() { performAction?("setup") }
}
