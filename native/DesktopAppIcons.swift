import AppKit
import WebKit

/// Local presentation only. Never launches an application or fetches a remote image.
final class DesktopAppIcons {
    struct Entry {
        let url: URL
        let aliases: Set<String>
        let bundle: String
    }
    private let scanQueue = DispatchQueue(label: "local.hotturkey.application-icons", qos: .utility)
    private var catalog: [Entry] = []
    private var catalogAt = Date.distantPast
    private var loading = false
    private var waiting: [([String], ([[String: Any]]) -> Void)] = []
    private var images: [URL: String] = [:]

    static func key(_ value: String) -> String {
        var value = value.precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines)
        let binary = value.hasPrefix("binary:/")
        if binary || value.hasPrefix("/") {
            let path = binary ? String(value.dropFirst(7)) : value
            var normalized = URL(fileURLWithPath: path).standardizedFileURL.resolvingSymlinksInPath().path
            while normalized.count > 1 && normalized.hasSuffix("/") { normalized.removeLast() }
            value = (binary ? "binary:" : "") + normalized
        }
        return value.lowercased()
    }
    static func canonical(_ url: URL) -> URL {
        URL(fileURLWithPath: url.standardizedFileURL.resolvingSymlinksInPath().path, isDirectory: true)
    }
    static func entry(_ url: URL, localized: Bool = true) -> Entry? {
        let url = canonical(url)
        guard url.pathExtension == "app", let bundle = Bundle(url: url),
              let info = bundle.infoDictionary, let ident = info["CFBundleIdentifier"] as? String else { return nil }
        var aliases = Set([key(url.deletingPathExtension().lastPathComponent), key(ident), key("bundle:" + ident), key(url.path)])
        for values in [info, bundle.localizedInfoDictionary ?? [:]] {
            for field in ["CFBundleName", "CFBundleDisplayName", "CFBundleExecutable"] {
                if let name = values[field] as? String { aliases.insert(key(name)) }
            }
        }
        if let executable = bundle.executableURL {
            aliases.insert(key(executable.path)); aliases.insert(key("binary:" + executable.path))
        }
        // Historical usage names can be localized differently from today's UI.
        let resources = url.appendingPathComponent("Contents/Resources")
        let locales = localized ? ((try? FileManager.default.contentsOfDirectory(at: resources, includingPropertiesForKeys: nil)) ?? []) : []
        for locale in locales.filter({ localized && $0.pathExtension == "lproj" }).prefix(80) {
            let path = locale.appendingPathComponent("InfoPlist.strings")
            guard let size = try? path.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 512 * 1024,
                  let data = try? Data(contentsOf: path) else { continue }
            var values = (try? PropertyListSerialization.propertyList(from: data, format: nil)) as? [String: Any]
            if values == nil {
                // Text .strings tables omit the braces used by OpenStep plists.
                let utf16 = data.starts(with: [0xff, 0xfe]) || data.starts(with: [0xfe, 0xff])
                if let text = String(data: data, encoding: utf16 ? .utf16 : .utf8),
                   let wrapped = ("{\n" + text + "\n}").data(using: .utf8) {
                    values = (try? PropertyListSerialization.propertyList(from: wrapped, format: nil)) as? [String: Any]
                }
            }
            guard let values else { continue }
            for field in ["CFBundleName", "CFBundleDisplayName"] {
                if let name = values[field] as? String { aliases.insert(key(name)) }
            }
        }
        aliases.remove("")
        return Entry(url: url, aliases: aliases, bundle: ident)
    }
    static func scan(roots: [URL]) -> [Entry] {
        var found: [URL: Entry] = [:]
        var queue = roots.map { ($0, 0) }, visited = 0
        while !queue.isEmpty && visited < 3000 {
            let (directory, depth) = queue.removeFirst()
            let children = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles])) ?? []
            for path in children {
                visited += 1
                if path.pathExtension == "app" {
                    if let item = entry(path) { found[item.url] = item }
                } else if depth < 3, !["bundle", "framework", "xpc", "plugin"].contains(path.pathExtension), (try? path.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true {
                    queue.append((path, depth + 1))
                }
                if visited >= 3000 { break }
            }
        }
        return Array(found.values)
    }
    static func matching(_ target: String, entries: [Entry], preferred: [Entry] = []) -> URL? {
        let needle = key(target)
        let installed = preferred.filter { $0.aliases.contains(needle) }
        // Helpers can inherit their parent's display name. Installed app metadata
        // takes precedence over process display names supplied by those helpers.
        let candidates = installed.isEmpty ? entries.filter { $0.aliases.contains(needle) } : installed
        let matches = Set(candidates.map(\.url))
        if matches.count == 1 { return matches.first }
        if !candidates.isEmpty && Set(candidates.map(\.bundle)).count == 1 {
            return matches.sorted { $0.path < $1.path }.first
        }
        // Different bundle identities with only a shared name remain ambiguous.
        return nil
    }
    func request(_ targets: [String], completion: @escaping ([[String: Any]]) -> Void) {
        guard !targets.isEmpty, targets.count <= 100, targets.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 8192 && !$0.contains("\0") }) else { completion([]); return }
        waiting.append((Array(Set(targets)), completion))
        guard waiting.count <= 8 else { waiting.removeLast(); completion([]); return }
        if Date().timeIntervalSince(catalogAt) < 300 { drain(); return }
        guard !loading else { return }
        loading = true
        let home = FileManager.default.homeDirectoryForCurrentUser
        let roots = [URL(fileURLWithPath: "/Applications"), home.appendingPathComponent("Applications"),
                     URL(fileURLWithPath: "/System/Applications"), URL(fileURLWithPath: "/System/Library/CoreServices")]
        scanQueue.async { [weak self] in
            let entries = Self.scan(roots: roots)
            DispatchQueue.main.async {
                guard let self else { return }
                self.catalog = entries; self.catalogAt = Date(); self.loading = false
                self.images.removeAll(); self.drain()
            }
        }
    }
    private func drain() {
        let requests = waiting; waiting.removeAll()
        var running: [Entry] = []
        for app in NSWorkspace.shared.runningApplications {
            guard let url = app.bundleURL, var entry = catalog.first(where: { $0.url == Self.canonical(url) }) ?? Self.entry(url, localized: false) else { continue }
            if let name = app.localizedName {
                entry = Entry(url: entry.url, aliases: entry.aliases.union([Self.key(name)]), bundle: entry.bundle)
            }
            running.append(entry)
        }
        let entries = catalog + running
        for (targets, completion) in requests {
            render(targets, entries: entries, results: [], completion: completion)
        }
    }
    private func render(_ targets: [String], entries: [Entry], results: [[String: Any]], completion: @escaping ([[String: Any]]) -> Void) {
        guard let target = targets.first else { completion(results); return }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            var url = Self.matching(target, entries: entries, preferred: self.catalog)
            // Launch Services also knows apps installed outside the usual folders.
            if url == nil && !entries.contains(where: { $0.aliases.contains(Self.key(target)) }) {
                if target.hasPrefix("bundle:") { url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: String(target.dropFirst(7))) }
                else if target.hasPrefix("/") || target.hasPrefix("binary:/") {
                    var path = URL(fileURLWithPath: target.hasPrefix("binary:") ? String(target.dropFirst(7)) : target)
                    while path.path != "/" {
                        if path.pathExtension == "app", let item = Self.entry(path, localized: false), item.aliases.contains(Self.key(target)) { url = item.url; break }
                        path.deleteLastPathComponent()
                    }
                } else if !target.contains("/") && !target.contains(":") {
                    url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: target)

                    if url == nil, let path = NSWorkspace.shared.fullPath(forApplication: target), let item = Self.entry(URL(fileURLWithPath: path), localized: false), item.aliases.contains(Self.key(target)) { url = item.url }
                }
            }
            var value: [String: Any] = ["target": target]
            if let url, let png = self.image(url) { value["image"] = png }
            self.render(Array(targets.dropFirst()), entries: entries, results: results + [value], completion: completion)
        }
    }
    private func image(_ url: URL) -> String? {
        if let cached = images[url] { return cached }
        let source: NSImage
        if Bundle(url: url)?.bundleIdentifier == "com.apple.loginwindow",
           let symbol = NSImage(systemSymbolName: "person.crop.circle", accessibilityDescription: nil)?.withSymbolConfiguration(
                NSImage.SymbolConfiguration(paletteColors: [NSColor(srgbRed: 0, green: 0.48, blue: 1, alpha: 1)])) {
            // The macOS login component has no app artwork of its own.
            source = symbol
        } else {
            source = NSWorkspace.shared.icon(forFile: url.path)
        }
        guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 96, pixelsHigh: 96,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
              let context = NSGraphicsContext(bitmapImageRep: bitmap) else { return nil }
        NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = context
        context.imageInterpolation = .high
        context.cgContext.clear(CGRect(x: 0, y: 0, width: 96, height: 96))
        source.draw(in: NSRect(x: 0, y: 0, width: 96, height: 96), from: .zero, operation: .sourceOver, fraction: 1)
        NSGraphicsContext.restoreGraphicsState()
        guard let data = bitmap.representation(using: .png, properties: [:]), data.count <= 64 * 1024 else { return nil }
        let image = "data:image/png;base64," + data.base64EncodedString()
        if images.count >= 256 { images.removeAll() }
        images[url] = image
        return image
    }
}
