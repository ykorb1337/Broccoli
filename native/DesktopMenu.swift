import AppKit

enum DesktopMenu {
    static func install(delegate: Delegate) {
        let app = NSApplication.shared, main = NSMenu()
        func section(_ title: String) -> NSMenu {
            let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            let menu = NSMenu(title: title); item.submenu = menu; main.addItem(item)
            return menu
        }
        let application = section("HotTurkey")
        application.addItem(withTitle: "关于 HotTurkey", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        application.addItem(.separator())
        let settings = application.addItem(withTitle: "设置…", action: #selector(Delegate.showSettings), keyEquivalent: ",")
        settings.target = delegate
        application.addItem(.separator())
        let servicesItem = NSMenuItem(title: "服务", action: nil, keyEquivalent: "")
        let services = NSMenu(title: "服务"); servicesItem.submenu = services; application.addItem(servicesItem); app.servicesMenu = services
        application.addItem(.separator())
        application.addItem(withTitle: "隐藏 HotTurkey", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = application.addItem(withTitle: "隐藏其他", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        application.addItem(withTitle: "显示全部", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        application.addItem(.separator())
        application.addItem(withTitle: "退出 HotTurkey", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let file = section("文件")
        file.addItem(withTitle: "新建拦截规则", action: #selector(Delegate.createRule(_:)), keyEquivalent: "n").target = delegate
        let sleep = file.addItem(withTitle: "新建睡眠计划", action: #selector(Delegate.createDevicePlan(_:)), keyEquivalent: "n")
        sleep.target = delegate; sleep.keyEquivalentModifierMask = [.command, .shift]
        file.addItem(.separator())
        file.addItem(withTitle: "关闭窗口", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")

        let edit = section("编辑")
        edit.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        for (title, action, key) in [("剪切", "cut:", "x"), ("复制", "copy:", "c"), ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }

        let view = section("显示")
        let pages = [("overview", "概览"), ("blocks", "规则"), ("schedule", "日程"), ("statistics", "统计"), ("settings", "设置")]
        for (index, page) in pages.enumerated() {
            let item = view.addItem(withTitle: page.1, action: #selector(Delegate.selectPage(_:)), keyEquivalent: String(index+1))
            item.representedObject = page.0; item.target = delegate
        }
        view.addItem(.separator())
        let sidebar = view.addItem(withTitle: "显示或隐藏侧栏", action: #selector(Delegate.toggleNavigation(_:)), keyEquivalent: "s")
        sidebar.keyEquivalentModifierMask = [.command, .control]; sidebar.target = delegate
        view.addItem(.separator())
        for (title, command, key) in [("放大", "increase", "="), ("缩小", "decrease", "-"), ("实际大小", "reset", "0")] {
            let item = view.addItem(withTitle: title, action: #selector(Delegate.resizeText(_:)), keyEquivalent: key)
            item.representedObject = command; item.target = delegate
        }

        let windows = section("窗口")
        windows.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windows.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windows.addItem(.separator())
        windows.addItem(withTitle: "前置全部窗口", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
        app.windowsMenu = windows; app.mainMenu = main
    }
}

extension Delegate: NSMenuItemValidation {
    @objc func createRule(_ sender: Any?) { show(); appearance.create("new") }
    @objc func createDevicePlan(_ sender: Any?) { show(); appearance.create("new-device") }
    @objc func selectPage(_ sender: NSMenuItem) {
        guard let page = sender.representedObject as? String else { return }
        show(); appearance.showPage(page)
    }
    @objc func toggleNavigation(_ sender: Any?) {
        guard appearance.canNavigate else { return }
        appearance.split.toggleSidebar(sender)
    }
    @objc func resizeText(_ sender: NSMenuItem) {
        if let command = sender.representedObject as? String { appearance.adjustTextSize(command) }
    }
    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        switch menuItem.action {
        case #selector(createRule(_:)), #selector(createDevicePlan(_:)): return appearance.canCreate
        case #selector(selectPage(_:)):
            menuItem.state = menuItem.representedObject as? String == appearance.currentPage ? .on : .off
            return appearance.canNavigate
        case #selector(toggleNavigation(_:)), #selector(showSettings): return appearance.canNavigate
        case #selector(resizeText(_:)):
            switch menuItem.representedObject as? String {
            case "increase": return nativeChromeInstalled && appearance.textScale < 200
            case "decrease": return nativeChromeInstalled && appearance.textScale > 50
            default: return nativeChromeInstalled && appearance.textScale != 100
            }
        default: return true
        }
    }
}
