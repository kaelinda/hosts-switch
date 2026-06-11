import AppKit

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let iconsDir = root.appendingPathComponent("src-tauri/icons", isDirectory: true)
try FileManager.default.createDirectory(at: iconsDir, withIntermediateDirectories: true)

func drawIcon(size: CGFloat) -> NSImage {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()

    let rect = NSRect(x: 0, y: 0, width: size, height: size)
    NSColor(calibratedRed: 0.06, green: 0.28, blue: 0.23, alpha: 1).setFill()
    NSBezierPath(roundedRect: rect, xRadius: size * 0.2, yRadius: size * 0.2).fill()

    let inset = size * 0.17
    let panel = NSRect(x: inset, y: inset, width: size - inset * 2, height: size - inset * 2)
    NSColor(calibratedRed: 0.92, green: 0.98, blue: 0.95, alpha: 1).setStroke()
    let panelPath = NSBezierPath(roundedRect: panel, xRadius: size * 0.08, yRadius: size * 0.08)
    panelPath.lineWidth = max(2, size * 0.035)
    panelPath.stroke()

    let lineHeight = max(4, size * 0.055)
    let lineWidth = size * 0.46
    let startX = size * 0.34
    let colors = [
        NSColor(calibratedRed: 0.92, green: 0.98, blue: 0.95, alpha: 1),
        NSColor(calibratedRed: 0.48, green: 0.78, blue: 0.67, alpha: 1),
        NSColor(calibratedRed: 0.92, green: 0.98, blue: 0.95, alpha: 1),
    ]

    for index in 0..<3 {
        colors[index].setFill()
        let y = size * (0.63 - CGFloat(index) * 0.16)
        NSBezierPath(
            roundedRect: NSRect(x: startX, y: y, width: lineWidth, height: lineHeight),
            xRadius: lineHeight / 2,
            yRadius: lineHeight / 2
        ).fill()
    }

    NSColor(calibratedRed: 0.48, green: 0.78, blue: 0.67, alpha: 1).setFill()
    let knob = size * 0.11
    let knobXs = [size * 0.22, size * 0.7, size * 0.22]
    for index in 0..<3 {
        let y = size * (0.63 - CGFloat(index) * 0.16) - knob * 0.21
        NSBezierPath(ovalIn: NSRect(x: knobXs[index], y: y, width: knob, height: knob)).fill()
    }

    image.unlockFocus()
    return image
}

func writePng(_ image: NSImage, to url: URL, pixels: Int) throws {
    guard
        let tiff = image.tiffRepresentation,
        let bitmap = NSBitmapImageRep(data: tiff),
        let data = bitmap.representation(using: .png, properties: [:])
    else {
        throw NSError(domain: "HostsSwitchIcon", code: 1)
    }
    try data.write(to: url)
    if pixels != Int(image.size.width) {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/sips")
        task.arguments = ["-z", "\(pixels)", "\(pixels)", url.path]
        try task.run()
        task.waitUntilExit()
    }
}

let base = drawIcon(size: 1024)
try writePng(base, to: iconsDir.appendingPathComponent("icon.png"), pixels: 1024)
try writePng(base, to: iconsDir.appendingPathComponent("32x32.png"), pixels: 32)
try writePng(base, to: iconsDir.appendingPathComponent("128x128.png"), pixels: 128)
try writePng(base, to: iconsDir.appendingPathComponent("128x128@2x.png"), pixels: 256)

let iconset = iconsDir.appendingPathComponent("icon.iconset", isDirectory: true)
try? FileManager.default.removeItem(at: iconset)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
let iconSizes = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
]

for (name, pixels) in iconSizes {
    try writePng(base, to: iconset.appendingPathComponent(name), pixels: pixels)
}

let iconutil = Process()
iconutil.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
iconutil.arguments = ["-c", "icns", iconset.path, "-o", iconsDir.appendingPathComponent("icon.icns").path]
try iconutil.run()
iconutil.waitUntilExit()
try? FileManager.default.removeItem(at: iconset)
