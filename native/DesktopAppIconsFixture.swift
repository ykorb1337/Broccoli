import AppKit
import WebKit
import Darwin

/// Real local icons and WebKit; the driver always disables policy execution.
@MainActor final class AppIconsQA {
    let d: Delegate
    let root: URL
    var checks: [String: Bool] = [:]
    var realApplicationCount = 0
    init(_ delegate: Delegate, root: String) { d = delegate; self.root = URL(fileURLWithPath: root) }
    func fail(_ text: String) -> NSError { NSError(domain: "HotTurkey.AppIconsQA", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
    func check(_ value: Bool, _ name: String) throws { guard value else { throw fail(name) }; checks[name] = true }
    @discardableResult func js(_ code: String) async throws -> Any? {
        try await d.web.callAsyncJavaScript(code, arguments: [:], in: nil, contentWorld: .page)
    }
    func wait(_ text: String, _ test: () -> Bool) async throws {
        let end = Date().addingTimeInterval(15)
        while !test() { if Date() > end { throw fail(text) }; try await Task.sleep(nanoseconds: 50_000_000) }
    }
    func waitJS(_ expression: String) async throws {
        let end = Date().addingTimeInterval(20)
        while (try await js("return Boolean(\(expression));")) as? Bool != true {
            if Date() > end {
                let details = try? await js("return JSON.stringify({page:document.body.dataset.view,authenticated:state?.authenticated,targets:window.__iconTargets,icons:[...document.querySelectorAll('.activity-icon')].map(el=>({target:el.dataset.activityTarget,source:el.dataset.iconSource,loaded:Boolean(el.querySelector('img')),complete:el.querySelector('img')?.complete,width:el.querySelector('img')?.naturalWidth,identity:el.querySelector('img')?.src===window.__expectedIcons?.[el.dataset.activityTarget]}))});")
                throw fail("\(expression): \(details ?? "nil")")
            }; try await Task.sleep(nanoseconds: 60_000_000)
        }
    }
    func fixture(_ name: String, identifier: String, display: String) throws -> URL {
        let url = root.appendingPathComponent(name + ".app")
        let resources = url.appendingPathComponent("Contents/Resources/zh-Hans.lproj")
        try FileManager.default.createDirectory(at: resources, withIntermediateDirectories: true)
        let executable = url.appendingPathComponent("Contents/MacOS/FixtureExecutable")
        try FileManager.default.createDirectory(at: executable.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data().write(to: executable)
        let info = ["CFBundleIdentifier": identifier, "CFBundleName": display, "CFBundleExecutable": "FixtureExecutable", "CFBundlePackageType": "APPL"]
        try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0).write(to: url.appendingPathComponent("Contents/Info.plist"))
        if name == "First" {
            try "\"CFBundleDisplayName\" = \"本地化应用\";\n".data(using: .utf16)!.write(to: resources.appendingPathComponent("InfoPlist.strings"))
        } else {
            try PropertyListSerialization.data(fromPropertyList: ["CFBundleDisplayName": "本地化应用"], format: .binary, options: 0).write(to: resources.appendingPathComponent("InfoPlist.strings"))
        }
        return url
    }
    func request(_ service: DesktopAppIcons, _ targets: [String]) async -> [[String: Any]] {
        await withCheckedContinuation { continuation in service.request(targets) { continuation.resume(returning: $0) } }
    }
    func capture(_ name: String) async throws {
        try await js("await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));")
        let config = WKSnapshotConfiguration(); config.afterScreenUpdates = true
        let image: NSImage = try await withCheckedThrowingContinuation { continuation in
            d.web.takeSnapshot(with: config) { image, error in
                if let image { continuation.resume(returning: image) }
                else { continuation.resume(throwing: error ?? self.fail("Snapshot failed")) }
            }
        }
        guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let data = bitmap.representation(using: .png, properties: [:]) else { throw fail("Invalid snapshot") }
        try data.write(to: root.appendingPathComponent("build/Activity-icons-\(name).png"))
    }
    func run() async throws {
        try await wait("Application did not load") { d.navigationFinished && d.nativeChromeInstalled }
        d.show(); try await wait("Window did not activate") { NSApp.isActive && d.window.isKeyWindow }
        let first = try fixture("First", identifier: "local.hotturkey.first", display: "Shared name")
        let second = try fixture("Second", identifier: "local.hotturkey.second", display: "Shared name")
        let entries = DesktopAppIcons.scan(roots: [root])
        try check(entries.contains { $0.bundle == "local.hotturkey.first" } && entries.contains { $0.bundle == "local.hotturkey.second" }, "synthetic_bundles_are_indexed")
        try check(DesktopAppIcons.matching("本地化应用", entries: entries) == nil, "ambiguous_localized_names_do_not_guess")
        try check(DesktopAppIcons.matching("Shared name", entries: entries) == nil, "ambiguous_display_names_do_not_guess")
        try check(DesktopAppIcons.matching("bundle:local.hotturkey.first", entries: entries) == DesktopAppIcons.canonical(first), "bundle_identity_disambiguates")
        try check(DesktopAppIcons.matching(second.path, entries: entries) == DesktopAppIcons.canonical(second), "exact_bundle_path_disambiguates")
        try check(DesktopAppIcons.matching("binary:" + first.appendingPathComponent("Contents/MacOS/FixtureExecutable").path, entries: entries) == DesktopAppIcons.canonical(first), "executable_path_maps_to_bundle")
        try check(DesktopAppIcons.matching("First substring", entries: entries) == nil, "name_substrings_do_not_match")
        try check(DesktopAppIcons.entry(first)?.aliases.contains("本地化应用") == true, "localized_plist_names_are_indexed")
        let parent = DesktopAppIcons.entry(first)!, helper = DesktopAppIcons.Entry(url: DesktopAppIcons.canonical(second), aliases: parent.aliases, bundle: "local.hotturkey.helper")
        try check(DesktopAppIcons.matching("First", entries: [parent, helper], preferred: [parent]) == parent.url, "helper_display_name_does_not_replace_parent_icon")
        let copy = DesktopAppIcons.Entry(url: helper.url, aliases: parent.aliases, bundle: parent.bundle)
        try check(DesktopAppIcons.matching("First", entries: [parent, copy]) != nil, "same_bundle_identity_is_not_a_different_app")
        let candidates = [("微信", "/Applications/WeChat.app"), ("ChatGPT", "/Applications/ChatGPT.app"),
            ("GoLand", "/Applications/GoLand.app"), ("Tabby", "/Applications/Tabby.app"),
            ("Obsidian", "/Applications/Obsidian.app"), ("loginwindow", "/System/Library/CoreServices/loginwindow.app")]
        let samples = candidates.filter { FileManager.default.fileExists(atPath: $0.1) }
        realApplicationCount = samples.count
        try check(!samples.isEmpty, "real_installed_applications_available")
        let resolver = DesktopAppIcons()
        let values = await request(resolver, samples.map(\.0))
        var expected: [String: String] = [:]
        for (name, path) in samples {
            guard let value = values.first(where: { $0["target"] as? String == name }), let source = value["image"] as? String,
                let data = Data(base64Encoded: String(source.dropFirst("data:image/png;base64,".count))), let image = NSBitmapImageRep(data: data),
                let ident = Bundle(path: path)?.bundleIdentifier else { throw fail("Real icon missing: \(name); local aliases=\(DesktopAppIcons.entry(URL(fileURLWithPath:path))?.aliases.sorted() ?? []); results=\(values.map { ["target": $0["target"] as? String ?? "", "imageBytes": String(($0["image"] as? String ?? "").count)] })") }
            try check(image.pixelsWide == 96 && image.pixelsHigh == 96 && data.count > 100, "real_icon_\(name)_retina")
            let exact = await request(resolver, ["bundle:" + ident])
            try check(exact.first?["image"] as? String == source, "real_icon_\(name)_identity_matches")
            expected[name] = source
        }
        let invalid = await request(resolver, Array(repeating: "invalid", count: 101))
        try check(invalid.isEmpty, "oversized_native_request_rejected")
        let absent = "Uninstalled fixture " + UUID().uuidString
        let missing = await request(resolver, [absent])
        try check(missing.count == 1 && missing.first?["image"] == nil, "missing_application_has_no_invented_icon")
        let json = String(data: try JSONSerialization.data(withJSONObject: expected), encoding: .utf8)!
        let targets = String(data: try JSONSerialization.data(withJSONObject: samples.map(\.0) + ["Uninstalled application icon fixture"]), encoding: .utf8)!
        d.show(); try await wait("Window did not activate") { NSApp.isActive && d.window.isKeyWindow }
        d.appearance.showPage("statistics")
        try await waitJS("document.body.dataset.view==='statistics'&&stats?.items?.length>0")
        for (profile, theme, scale) in [("light", "light", 100), ("dark", "dark", 100), ("dark-200", "dark", 200)] {
            d.show(); try await wait("Window did not activate") { NSApp.isActive && d.window.isKeyWindow }
            try await js("await api('settings',{theme:'\(theme)',text_scale:\(scale)});await refresh(false);window.__expectedIcons=\(json);window.__iconTargets=\(targets);await loadStats();renderPage();")
            try await waitJS("document.querySelectorAll('.activity-icon[data-activity-kind=application]').length===window.__iconTargets.length&&[...document.querySelectorAll('.activity-icon[data-activity-kind=application]')].filter(el=>window.__expectedIcons[el.dataset.activityTarget]).every(el=>el.querySelector('img')?.complete&&el.querySelector('img').naturalWidth===96&&el.querySelector('img').src===window.__expectedIcons[el.dataset.activityTarget])")
            let imageCount = (try await js("return document.querySelectorAll('.activity-icon img').length===Object.keys(window.__expectedIcons).length;")) as? Bool == true
            if !imageCount {
                let details = try await js("return JSON.stringify({expected:Object.keys(window.__expectedIcons),icons:[...document.querySelectorAll('.activity-icon')].map(el=>({target:el.dataset.activityTarget,source:el.dataset.iconSource,loaded:Boolean(el.querySelector('img'))}))});")
                throw fail("\(profile)_real_images_rendered: \(details ?? "nil")")
            }
            try check(imageCount, "\(profile)_real_images_rendered")
            try check((try await js("return [...document.querySelectorAll('.activity-icon img')].every(el=>getComputedStyle(el).opacity==='1'&&el.getBoundingClientRect().width>=20&&!el.closest('.application-monogram'));")) as? Bool == true, "\(profile)_color_and_size_preserved")
            try check((try await js("return document.querySelector('.activity-icon[data-activity-kind=website] .symbol').dataset.symbol==='globe'&&document.querySelectorAll('.application-monogram').length===1;")) as? Bool == true, "\(profile)_website_and_unknown_remain_distinct")
            try await capture(profile)
        }
        try await js("const select=document.querySelector('#stats-metric');select.value='blocked';select.dispatchEvent(new Event('change',{bubbles:true}));")
        try await waitJS("[...document.querySelectorAll('.activity-icon[data-activity-kind=application]')].filter(el=>window.__expectedIcons[el.dataset.activityTarget]).every(el=>el.querySelector('img')?.complete&&el.querySelector('img').src===window.__expectedIcons[el.dataset.activityTarget])")
        try check(true, "sorting_keeps_target_icon_identity")
        let last = samples.last!.0
        let lastJSON = String(data: try JSONSerialization.data(withJSONObject: [last]), encoding: .utf8)!
        try await js("const input=document.querySelector('#stats-query');input.value=\(lastJSON)[0];input.dispatchEvent(new Event('input',{bubbles:true}));")
        try await waitJS("document.querySelectorAll('.activity-icon img').length===1&&document.querySelector('.activity-icon img').src===window.__expectedIcons[document.querySelector('.activity-icon').dataset.activityTarget]")
        try check(true, "rerender_keeps_exact_target_icon")
        try await js("const before=document.querySelector('.activity-icon img').src;window.HotTurkeyActivityIcons.apply([{target:document.querySelector('.activity-icon').dataset.activityTarget,image:'https://invalid.example/icon.png'}]);window.__invalidIconIgnored=document.querySelector('.activity-icon img').src===before;")
        try check((try await js("return window.__invalidIconIgnored;")) as? Bool == true, "unsolicited_remote_image_is_ignored")
    }
    func finish(_ error: Error? = nil) {
        let proof: [String: Any] = ["passed": error == nil, "checks": checks, "error": error?.localizedDescription ?? "", "real_installed_application_count": realApplicationCount,
            "physical_device_actions": false, "formal_data_changed": false, "network_icons_fetched": false, "enforcement": false]
        if let data = try? JSONSerialization.data(withJSONObject: proof, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: root.appendingPathComponent("build/native-icons-proof.json")) }
        NSApp.terminate(nil)
    }
}
@main @MainActor enum IconsFixture {
    static func main() {
        alarm(90)
        let app = NSApplication.shared, delegate = Delegate()
        app.setActivationPolicy(.regular); app.delegate = delegate
        DesktopMenu.install(delegate: delegate)
        let qa = AppIconsQA(delegate, root: CommandLine.arguments[1])
        Task { @MainActor in do { try await qa.run(); qa.finish() } catch { qa.finish(error) } }
        withExtendedLifetime((delegate, qa)) { app.run() }
    }
}
