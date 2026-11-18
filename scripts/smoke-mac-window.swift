import AppKit
import CoreGraphics
import Foundation

// Un relanzamiento correcto tiene un proceso nuevo y una ventana visible en el mismo paquete instalado.
let bundle = URL(fileURLWithPath: CommandLine.arguments[1]).resolvingSymlinksInPath()
let oldPid = Int32(CommandLine.arguments[2])
let until = Date().addingTimeInterval(60)
repeat {
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    for app in NSWorkspace.shared.runningApplications where app.bundleURL?.resolvingSymlinksInPath() == bundle && app.processIdentifier != oldPid {
        if windows.contains(where: { window in
            window[kCGWindowOwnerPID as String] as? Int32 == app.processIdentifier && window[kCGWindowLayer as String] as? Int == 0
        }) {
            print(app.processIdentifier)
            exit(0)
        }
    }
    RunLoop.current.run(until: Date().addingTimeInterval(0.5))
} while Date() < until
FileHandle.standardError.write(Data("La candidata no abrió su ventana.\n".utf8))
exit(1)
