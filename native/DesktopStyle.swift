import AppKit
import WebKit

final class AppearanceHost: NSView {
    var appearanceChanged: (() -> Void)?
    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        appearanceChanged?()
    }
}

/// Resolve semantic AppKit colors in the window's actual appearance. The page
/// keeps CSS fallbacks for browsers and older desktop versions.
final class DesktopStyle {
    weak var window: NSWindow?
    weak var web: WKWebView?
    private var observers: [(NotificationCenter, NSObjectProtocol)] = []
    private var lastPayload = ""

    init(window: NSWindow, web: WKWebView) {
        self.window = window; self.web = web
        for name in [NSColor.systemColorsDidChangeNotification, NSWindow.didBecomeKeyNotification,
                     NSWindow.didResignKeyNotification, NSApplication.didBecomeActiveNotification,
                     NSApplication.didResignActiveNotification] {
            observe(NotificationCenter.default, name)
        }
        observe(NSWorkspace.shared.notificationCenter, NSWorkspace.accessibilityDisplayOptionsDidChangeNotification)
    }

    deinit { for (center, observer) in observers { center.removeObserver(observer) } }

    private func observe(_ center: NotificationCenter, _ name: Notification.Name) {
        let observer = center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in self?.refresh() }
        observers.append((center, observer))
    }

    static func css(_ color: NSColor) -> String {
        guard let value = color.usingColorSpace(.sRGB) else { return "transparent" }
        return String(format: "rgba(%d,%d,%d,%.4f)", locale: Locale(identifier: "en_US_POSIX"),
                      Int((value.redComponent * 255).rounded()), Int((value.greenComponent * 255).rounded()),
                      Int((value.blueComponent * 255).rounded()), value.alphaComponent)
    }

    static func payload(appearance: NSAppearance, active: Bool) -> [String: Any] {
        let workspace = NSWorkspace.shared
        let contrast = workspace.accessibilityDisplayShouldIncreaseContrast
        var colors: [String: String] = [:]
        appearance.performAsCurrentDrawingAppearance {
            let dark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            let values: [String: NSColor] = [
                "--bg": .windowBackgroundColor, "--panel": .controlBackgroundColor,
                "--ink": .labelColor,
                // Opaque secondary text stays readable on cards and window surfaces.
                "--muted": NSColor.labelColor.withAlphaComponent(1).blended(
                    withFraction: contrast ? 0.15 : 0.35,
                    of: .controlBackgroundColor.withAlphaComponent(1)) ?? .labelColor,
                "--line": contrast ? .labelColor.withAlphaComponent(0.4) : .separatorColor,
                "--accent": .controlAccentColor, "--tint": .controlAccentColor.withAlphaComponent(0.12),
                "--field": .quaternaryLabelColor, "--hover": .quaternaryLabelColor,
                "--green": .systemGreen, "--green-tint": .systemGreen.withAlphaComponent(0.12),
                "--green-text": dark ? .systemGreen : NSColor.systemGreen.blended(withFraction: 0.55, of: .labelColor) ?? .labelColor,
                "--danger": .systemRed, "--warning": .systemOrange,
                "--warning-text": dark ? .systemOrange : NSColor.systemOrange.blended(withFraction: 0.55, of: .labelColor) ?? .labelColor,
                "--warning-tint": .systemOrange.withAlphaComponent(0.12),
                "--focus": .keyboardFocusIndicatorColor, "--selection": .selectedTextBackgroundColor,
                "--selection-ink": .selectedTextColor, "--primary-ink": .selectedMenuItemTextColor,
                "--inactive-selection": .unemphasizedSelectedContentBackgroundColor,
                "--disabled": .disabledControlTextColor, "--link": .linkColor
            ]
            colors = values.mapValues(css)
        }
        return ["colors": colors, "symbols": symbols, "appearance": appearance.name.rawValue,
                "active": active, "reduceMotion": workspace.accessibilityDisplayShouldReduceMotion,
                "reduceTransparency": workspace.accessibilityDisplayShouldReduceTransparency,
                "increaseContrast": contrast]
    }

    func refresh(force: Bool = false) {
        guard let window, let web else { return }
        let value = Self.payload(appearance: window.effectiveAppearance,
                                 active: NSApp.isActive && (web.window?.isKeyWindow == true))
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: .sortedKeys),
              let json = String(data: data, encoding: .utf8), force || json != lastPayload else { return }
        lastPayload = json
        web.evaluateJavaScript("window.HotTurkeyAppearance?.apply(\(json)); true") { [weak self] _, error in
            if error != nil { self?.lastPayload = "" }
        }
    }

    // SF Symbols come from the user's installed macOS. A monochrome mask lets
    // the same glyph follow semantic text colors without re-rendering on theme changes.
    static let symbols: [String: String] = {
        let names = ["overview":"square.grid.2x2", "shield":"shield.lefthalf.filled", "calendar":"calendar",
                     "chart":"chart.bar.xaxis", "settings":"gearshape", "moon":"moon", "plus":"plus",
                     "close":"xmark", "copy":"doc.on.doc", "download":"square.and.arrow.down",
                     "upload":"square.and.arrow.up", "lock":"lock", "reset":"arrow.counterclockwise",
                     "trash":"trash", "folder":"folder", "app":"app", "application":"macwindow.on.rectangle", "terminal":"terminal", "globe":"globe", "bed":"bed.double"]
        var result: [String: String] = [:]
        for (key, name) in names {
            guard let image = NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(
                    NSImage.SymbolConfiguration(pointSize: 18, weight: .regular)),
                  let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 36, pixelsHigh: 36,
                    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
                  let context = NSGraphicsContext(bitmapImageRep: bitmap) else { continue }
            NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = context
            context.cgContext.clear(CGRect(x: 0, y: 0, width: 36, height: 36))
            let factor = 32 / max(image.size.width, image.size.height)
            let size = NSSize(width: image.size.width * factor, height: image.size.height * factor)
            NSAppearance(named: .aqua)?.performAsCurrentDrawingAppearance {
                image.draw(in: NSRect(x: (36-size.width)/2, y: (36-size.height)/2, width: size.width, height: size.height))
            }
            NSGraphicsContext.restoreGraphicsState()
            if let data = bitmap.representation(using: .png, properties: [:]) {
                result[key] = "data:image/png;base64," + data.base64EncodedString()
            }
        }
        return result
    }()
}
